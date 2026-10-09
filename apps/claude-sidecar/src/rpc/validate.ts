/**
 * Inbound parameter validation at the RPC boundary.
 *
 * Each operation's params are checked structurally before any id is branded
 * or any state is touched. Unknown extra fields are ignored so that additive
 * v1 changes from a newer companion do not break an older sidecar. A failed
 * check becomes a `-32602` error with the offending path.
 */

import type {
  AppThreadId,
  ClientMessageId,
  ItemId,
  OperationName,
  ProviderId,
  ProviderThreadRef,
  TurnId,
  OperationParams,
  RuntimeResponse,
  ThreadChange,
  ThreadListParams,
  ThreadSettings,
  UserContent,
} from "../protocol.js";
import { isRecord } from "../mapping/frames.js";

type Check<Value> = (value: unknown, path: string) => Value;

export class ParamsError extends Error {
  override readonly name = "ParamsError";
}

const fail = (path: string, expected: string): never => {
  throw new ParamsError(`${path}: expected ${expected}`);
};

const str: Check<string> = (value, path) => (typeof value === "string" ? value : fail(path, "string"));
const bool: Check<boolean> = (value, path) => (typeof value === "boolean" ? value : fail(path, "boolean"));
const int: Check<number> = (value, path) => (typeof value === "number" && Number.isSafeInteger(value) ? value : fail(path, "integer"));
const num: Check<number> = (value, path) => (typeof value === "number" && Number.isFinite(value) ? value : fail(path, "number"));
const nullable =
  <Value>(inner: Check<Value>): Check<Value | null> =>
  (value, path) =>
    value === null || value === undefined ? null : inner(value, path);
const oneOf =
  <Literal extends string>(...allowed: readonly Literal[]): Check<Literal> =>
  (value, path) =>
    typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as Literal) : fail(path, allowed.join(" | ")); // WHY: membership checked.
const record = (value: unknown, path: string): Readonly<Record<string, unknown>> => (isRecord(value) ? value : fail(path, "object"));
const list =
  <Value>(inner: Check<Value>): Check<readonly Value[]> =>
  (value, path) =>
    Array.isArray(value) ? value.map((entry: unknown, index) => inner(entry, `${path}[${index}]`)) : fail(path, "array");

const requestId: Check<string | number> = (value, path) =>
  typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value)) ? value : fail(path, "request id");

const userContent: Check<UserContent> = (value, path) => {
  const content = record(value, path);
  switch (content["type"]) {
    case "text":
      return { type: "text", text: str(content["text"], `${path}.text`) };
    case "image":
      return { type: "image", url: str(content["url"], `${path}.url`) };
    case "localImage":
      return { type: "localImage", path: str(content["path"], `${path}.path`) };
    default:
      return fail(`${path}.type`, "text | image | localImage");
  }
};

const settings: Check<ThreadSettings> = (value, path) => {
  const object = record(value, path);
  return {
    model: str(object["model"], `${path}.model`),
    effort: nullable(str)(object["effort"], `${path}.effort`),
    permissionProfile: str(object["permissionProfile"], `${path}.permissionProfile`),
    serviceTier: nullable(str)(object["serviceTier"], `${path}.serviceTier`),
  };
};

const threadChange: Check<ThreadChange> = (value, path) => {
  const change = record(value, path);
  switch (change["type"]) {
    case "name":
      return { type: "name", name: nullable(str)(change["name"], `${path}.name`) };
    case "archived":
      return { type: "archived", archived: bool(change["archived"], `${path}.archived`) };
    case "deleted":
      return { type: "deleted" };
    case "settings":
      return {
        type: "settings",
        model: nullable(str)(change["model"], `${path}.model`),
        effort: nullable(str)(change["effort"], `${path}.effort`),
        permissionProfile: nullable(str)(change["permissionProfile"], `${path}.permissionProfile`),
        serviceTier: nullable(str)(change["serviceTier"], `${path}.serviceTier`),
      };
    default:
      return fail(`${path}.type`, "name | archived | deleted | settings");
  }
};

const runtimeResponse: Check<RuntimeResponse> = (value, path) => {
  const response = record(value, path);
  switch (response["type"]) {
    case "approval":
      return { type: "approval", decision: oneOf("accept", "acceptForSession", "decline", "cancel")(response["decision"], `${path}.decision`) };
    case "userInput": {
      const answers = record(response["answers"], `${path}.answers`);
      const parsed: Record<string, { readonly answers: readonly string[] }> = {};
      for (const [id, answer] of Object.entries(answers)) {
        parsed[id] = { answers: list(str)(record(answer, `${path}.answers.${id}`)["answers"], `${path}.answers.${id}.answers`) };
      }
      return { type: "userInput", answers: parsed };
    }
    case "capability":
      return { type: "capability", payload: null };
    case "error":
      return { type: "error", message: str(response["message"], `${path}.message`) };
    default:
      return fail(`${path}.type`, "approval | userInput | capability | error");
  }
};

const listParams: Check<ThreadListParams> = (value, path) => {
  const params = record(value, path);
  const window = params["window"];
  return {
    archived: bool(params["archived"], `${path}.archived`),
    cwd: nullable(str)(params["cwd"], `${path}.cwd`),
    searchTerm: nullable(str)(params["searchTerm"], `${path}.searchTerm`),
    sortKey: oneOf("createdAt", "updatedAt", "recencyAt")(params["sortKey"], `${path}.sortKey`),
    sortDirection: oneOf("asc", "desc")(params["sortDirection"], `${path}.sortDirection`),
    window:
      window === null || window === undefined
        ? null
        : {
            lower: nullable(num)(record(window, `${path}.window`)["lower"], `${path}.window.lower`),
            lowerInclusive: bool(record(window, `${path}.window`)["lowerInclusive"], `${path}.window.lowerInclusive`),
            upper: nullable(num)(record(window, `${path}.window`)["upper"], `${path}.window.upper`),
            upperInclusive: bool(record(window, `${path}.window`)["upperInclusive"], `${path}.window.upperInclusive`),
          },
    cursor: nullable(str)(params["cursor"], `${path}.cursor`),
    limit: int(params["limit"], `${path}.limit`),
  };
};

/**
 * Validated params of every operation. The sidecar works with the plain
 * string forms; services brand ids after this check.
 */
type BrandedId = AppThreadId | ClientMessageId | ItemId | ProviderId | ProviderThreadRef | TurnId;

type Unbranded<Value> = Value extends BrandedId
  ? string
  : Value extends readonly (infer Entry)[]
    ? readonly Unbranded<Entry>[]
    : Value extends object
      ? { readonly [Key in keyof Value]: Unbranded<Value[Key]> }
      : Value;

export type ValidParams<Name extends OperationName> = Unbranded<OperationParams<Name>>;

const validators: { readonly [Name in OperationName]: Check<ValidParams<Name>> } = {
  initialize: (value, path) => {
    const params = record(value, path);
    const client = record(params["client"], `${path}.client`);
    return {
      protocol: oneOf("codewide-agent")(params["protocol"], `${path}.protocol`),
      protocolVersion: int(params["protocolVersion"], `${path}.protocolVersion`),
      client: { name: str(client["name"], `${path}.client.name`), version: str(client["version"], `${path}.client.version`) },
    };
  },
  "catalog.models": (value, path) => (record(value ?? {}, path), {}),
  "catalog.permissionProfiles": (value, path) => (record(value ?? {}, path), {}),
  "thread.create": (value, path) => {
    const params = record(value, path);
    return {
      appThreadId: nullable(str)(params["appThreadId"], `${path}.appThreadId`),
      cwd: str(params["cwd"], `${path}.cwd`),
      settings: settings(params["settings"], `${path}.settings`),
    };
  },
  "thread.read": (value, path) => ({ appThreadId: str(record(value, path)["appThreadId"], `${path}.appThreadId`) }),
  "thread.list": listParams,
  "thread.turns": (value, path) => {
    const params = record(value, path);
    return {
      appThreadId: str(params["appThreadId"], `${path}.appThreadId`),
      cursor: nullable(str)(params["cursor"], `${path}.cursor`),
      limit: int(params["limit"], `${path}.limit`),
      sortDirection: oneOf("asc", "desc")(params["sortDirection"], `${path}.sortDirection`),
      itemsView: oneOf("notLoaded", "summary", "full")(params["itemsView"], `${path}.itemsView`),
    };
  },
  "thread.update": (value, path) => {
    const params = record(value, path);
    return { appThreadId: str(params["appThreadId"], `${path}.appThreadId`), change: threadChange(params["change"], `${path}.change`) };
  },
  "thread.owns": (value, path) => ({ appThreadId: str(record(value, path)["appThreadId"], `${path}.appThreadId`) }),
  "thread.compact": (value, path) => ({ appThreadId: str(record(value, path)["appThreadId"], `${path}.appThreadId`) }),
  "turn.start": (value, path) => {
    const params = record(value, path);
    return {
      appThreadId: str(params["appThreadId"], `${path}.appThreadId`),
      clientMessageId: nullable(str)(params["clientMessageId"], `${path}.clientMessageId`),
      input: list(userContent)(params["input"], `${path}.input`),
    };
  },
  "turn.steer": (value, path) => {
    const params = record(value, path);
    return {
      appThreadId: str(params["appThreadId"], `${path}.appThreadId`),
      expectedTurnId: str(params["expectedTurnId"], `${path}.expectedTurnId`),
      clientMessageId: nullable(str)(params["clientMessageId"], `${path}.clientMessageId`),
      input: list(userContent)(params["input"], `${path}.input`),
    };
  },
  "turn.interrupt": (value, path) => {
    const params = record(value, path);
    return { appThreadId: str(params["appThreadId"], `${path}.appThreadId`), turnId: nullable(str)(params["turnId"], `${path}.turnId`) };
  },
  "request.respond": (value, path) => {
    const params = record(value, path);
    return {
      appThreadId: str(params["appThreadId"], `${path}.appThreadId`),
      requestId: requestId(params["requestId"], `${path}.requestId`),
      response: runtimeResponse(params["response"], `${path}.response`),
    };
  },
  "capability.invoke": (value, path) => {
    const params = record(value, path);
    return { capability: str(params["capability"], `${path}.capability`), method: str(params["method"], `${path}.method`), params: null };
  },
};

export const OPERATIONS = Object.keys(validators) as readonly OperationName[]; // WHY: the keys of a mapped type over OperationName.

export function isOperation(method: string): method is OperationName {
  return (OPERATIONS as readonly string[]).includes(method);
}

export function validateParams<Name extends OperationName>(name: Name, params: unknown): ValidParams<Name> {
  return validators[name](params, "params");
}

