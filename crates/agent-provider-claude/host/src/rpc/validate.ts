/**
 * Inbound parameter validation at the RPC boundary.
 *
 * Each operation's params are checked structurally before any id is branded
 * or any state is touched. Unknown extra fields are ignored so that additive
 * v1 changes from a newer companion do not break an older host. A failed
 * check becomes a `-32602` error with the offending path.
 */

import type {
  AppThreadId,
  ClientMessageId,
  ClientToolSpec,
  ClientToolTextContent,
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
  ToolCallResult,
  UserContent,
} from "../protocol.js";
import {
  bool,
  int,
  list,
  nullable,
  num,
  oneOf,
  record,
  ShapeError,
  str,
  type Check,
} from "../validation/checks.js";
import { jsonValue } from "../validation/modelChecks.js";

const fail = (path: string, expected: string): never => {
  throw new ShapeError(`${path}: expected ${expected}`);
};

const requestId: Check<string | number> = (value, path) =>
  typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value))
    ? value
    : fail(path, "request id");

const userContent: Check<UserContent> = (value, path) => {
  const content = record(value, path);
  switch (content["type"]) {
    case "text":
      return { text: str(content["text"], `${path}.text`), type: "text" };
    case "image":
      return { type: "image", url: str(content["url"], `${path}.url`) };
    case "localImage":
      return { path: str(content["path"], `${path}.path`), type: "localImage" };
    default:
      return fail(`${path}.type`, "text | image | localImage");
  }
};

/** Tool names Claude accepts for MCP tools. */
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/u;

const clientToolSpec: Check<ClientToolSpec> = (value, path) => {
  const spec = record(value, path);
  const name = str(spec["name"], `${path}.name`);
  return {
    description: str(spec["description"], `${path}.description`),
    inputSchema: jsonValue(spec["inputSchema"], `${path}.inputSchema`),
    name: TOOL_NAME.test(name) ? name : fail(`${path}.name`, "tool name [A-Za-z0-9_-]{1,64}"),
  };
};

/** Absent `clientTools` is `null`: the thread keeps its current set. */
const clientTools: Check<readonly ClientToolSpec[] | null> = nullable(list(clientToolSpec));

const textContent: Check<ClientToolTextContent> = (value, path) => {
  const block = record(value, path);
  return {
    text: str(block["text"], `${path}.text`),
    type: oneOf(["text"])(block["type"], `${path}.type`),
  };
};

/** The companion's `tool.call` result. */
export const toolCallResult: Check<ToolCallResult> = (value, path) => {
  const result = record(value, path);
  return {
    content: list(textContent)(result["content"], `${path}.content`),
    success: bool(result["success"], `${path}.success`),
  };
};

const settings: Check<ThreadSettings> = (value, path) => {
  const object = record(value, path);
  return {
    effort: nullable(str)(object["effort"], `${path}.effort`),
    model: str(object["model"], `${path}.model`),
    permissionProfile: str(object["permissionProfile"], `${path}.permissionProfile`),
    serviceTier: nullable(str)(object["serviceTier"], `${path}.serviceTier`),
  };
};

const threadChange: Check<ThreadChange> = (value, path) => {
  const change = record(value, path);
  switch (change["type"]) {
    case "name":
      return { name: nullable(str)(change["name"], `${path}.name`), type: "name" };
    case "archived":
      return { archived: bool(change["archived"], `${path}.archived`), type: "archived" };
    case "deleted":
      return { type: "deleted" };
    case "settings":
      return {
        effort: nullable(str)(change["effort"], `${path}.effort`),
        model: nullable(str)(change["model"], `${path}.model`),
        permissionProfile: nullable(str)(change["permissionProfile"], `${path}.permissionProfile`),
        serviceTier: nullable(str)(change["serviceTier"], `${path}.serviceTier`),
        type: "settings",
      };
    default:
      return fail(`${path}.type`, "name | archived | deleted | settings");
  }
};

const runtimeResponse: Check<RuntimeResponse> = (value, path) => {
  const response = record(value, path);
  switch (response["type"]) {
    case "approval":
      return {
        decision: oneOf(["accept", "acceptForSession", "decline", "cancel"])(
          response["decision"],
          `${path}.decision`,
        ),
        type: "approval",
      };
    case "userInput": {
      const answers = record(response["answers"], `${path}.answers`);
      const parsed: Record<string, { readonly answers: readonly string[] }> = {};
      for (const [id, answer] of Object.entries(answers)) {
        parsed[id] = {
          answers: list(str)(
            record(answer, `${path}.answers.${id}`)["answers"],
            `${path}.answers.${id}.answers`,
          ),
        };
      }
      return { answers: parsed, type: "userInput" };
    }
    case "capability":
      return { payload: null, type: "capability" };
    case "error":
      return { message: str(response["message"], `${path}.message`), type: "error" };
    default:
      return fail(`${path}.type`, "approval | userInput | capability | error");
  }
};

const listParams: Check<ThreadListParams> = (value, path) => {
  const params = record(value, path);
  const window = params["window"];
  return {
    archived: bool(params["archived"], `${path}.archived`),
    cursor: nullable(str)(params["cursor"], `${path}.cursor`),
    cwd: nullable(str)(params["cwd"], `${path}.cwd`),
    limit: int(params["limit"], `${path}.limit`),
    searchTerm: nullable(str)(params["searchTerm"], `${path}.searchTerm`),
    sortDirection: oneOf(["asc", "desc"])(params["sortDirection"], `${path}.sortDirection`),
    sortKey: oneOf(["createdAt", "updatedAt", "recencyAt"])(params["sortKey"], `${path}.sortKey`),
    window:
      window === null || window === undefined
        ? null
        : {
            lower: nullable(num)(record(window, `${path}.window`)["lower"], `${path}.window.lower`),
            lowerInclusive: bool(
              record(window, `${path}.window`)["lowerInclusive"],
              `${path}.window.lowerInclusive`,
            ),
            upper: nullable(num)(record(window, `${path}.window`)["upper"], `${path}.window.upper`),
            upperInclusive: bool(
              record(window, `${path}.window`)["upperInclusive"],
              `${path}.window.upperInclusive`,
            ),
          },
  };
};

/**
 * Validated params of every operation. The host works with the plain
 * string forms; services brand ids after this check.
 */
type BrandedId = AppThreadId | ClientMessageId | ItemId | ProviderId | ProviderThreadRef | TurnId;

type Unbranded<Value> = Value extends BrandedId
  ? string
  : Value extends string | number | boolean | null
    ? Value
    : Value extends readonly (infer Entry)[]
      ? readonly Unbranded<Entry>[]
      : { readonly [Key in keyof Value]: Unbranded<Value[Key]> };

export type ValidParams<Name extends OperationName> = Unbranded<OperationParams<Name>>;

/** Operations whose params carry the optional client tools. */
type ClientToolOperation = "thread.create" | "turn.start";

/**
 * Params as the host uses them: the optional `clientTools` of the wire is
 * always present, `null` when the companion left it out.
 */
export type HostParams<Name extends OperationName> = Name extends ClientToolOperation
  ? Omit<ValidParams<Name>, "clientTools"> & {
      readonly clientTools: readonly ClientToolSpec[] | null;
    }
  : ValidParams<Name>;

const validators: { readonly [Name in OperationName]: Check<HostParams<Name>> } = {
  "capability.invoke": (value, path) => {
    const params = record(value, path);
    return {
      capability: str(params["capability"], `${path}.capability`),
      method: str(params["method"], `${path}.method`),
      params: null,
    };
  },
  "catalog.models": (value, path) => {
    record(value ?? {}, path);
    return {};
  },
  "catalog.permissionProfiles": (value, path) => {
    record(value ?? {}, path);
    return {};
  },
  initialize: (value, path) => {
    const params = record(value, path);
    const client = record(params["client"], `${path}.client`);
    return {
      client: {
        name: str(client["name"], `${path}.client.name`),
        version: str(client["version"], `${path}.client.version`),
      },
      protocol: oneOf(["codewide-agent"])(params["protocol"], `${path}.protocol`),
      protocolVersion: int(params["protocolVersion"], `${path}.protocolVersion`),
    };
  },
  "nativeSession.list": (value, path) => {
    const params = record(value, path);
    return {
      cursor: nullable(str)(params["cursor"], `${path}.cursor`),
      dir: nullable(str)(params["dir"], `${path}.dir`),
      limit: int(params["limit"], `${path}.limit`),
    };
  },
  "nativeSession.read": (value, path) => ({
    sessionId: str(record(value, path)["sessionId"], `${path}.sessionId`),
  }),
  "request.respond": (value, path) => {
    const params = record(value, path);
    return {
      appThreadId: str(params["appThreadId"], `${path}.appThreadId`),
      requestId: requestId(params["requestId"], `${path}.requestId`),
      response: runtimeResponse(params["response"], `${path}.response`),
    };
  },
  "thread.compact": (value, path) => ({
    appThreadId: str(record(value, path)["appThreadId"], `${path}.appThreadId`),
  }),
  "thread.create": (value, path) => {
    const params = record(value, path);
    return {
      appThreadId: nullable(str)(params["appThreadId"], `${path}.appThreadId`),
      clientTools: clientTools(params["clientTools"], `${path}.clientTools`),
      cwd: str(params["cwd"], `${path}.cwd`),
      settings: settings(params["settings"], `${path}.settings`),
    };
  },
  "thread.list": listParams,
  "thread.owns": (value, path) => ({
    appThreadId: str(record(value, path)["appThreadId"], `${path}.appThreadId`),
  }),
  "thread.read": (value, path) => ({
    appThreadId: str(record(value, path)["appThreadId"], `${path}.appThreadId`),
  }),
  "thread.turns": (value, path) => {
    const params = record(value, path);
    return {
      appThreadId: str(params["appThreadId"], `${path}.appThreadId`),
      cursor: nullable(str)(params["cursor"], `${path}.cursor`),
      itemsView: oneOf(["notLoaded", "summary", "full"])(params["itemsView"], `${path}.itemsView`),
      limit: int(params["limit"], `${path}.limit`),
      sortDirection: oneOf(["asc", "desc"])(params["sortDirection"], `${path}.sortDirection`),
    };
  },
  "thread.update": (value, path) => {
    const params = record(value, path);
    return {
      appThreadId: str(params["appThreadId"], `${path}.appThreadId`),
      change: threadChange(params["change"], `${path}.change`),
    };
  },
  "turn.interrupt": (value, path) => {
    const params = record(value, path);
    return {
      appThreadId: str(params["appThreadId"], `${path}.appThreadId`),
      turnId: nullable(str)(params["turnId"], `${path}.turnId`),
    };
  },
  "turn.start": (value, path) => {
    const params = record(value, path);
    return {
      appThreadId: str(params["appThreadId"], `${path}.appThreadId`),
      clientMessageId: nullable(str)(params["clientMessageId"], `${path}.clientMessageId`),
      clientTools: clientTools(params["clientTools"], `${path}.clientTools`),
      input: list(userContent)(params["input"], `${path}.input`),
    };
  },
  "turn.steer": (value, path) => {
    const params = record(value, path);
    return {
      appThreadId: str(params["appThreadId"], `${path}.appThreadId`),
      clientMessageId: nullable(str)(params["clientMessageId"], `${path}.clientMessageId`),
      expectedTurnId: str(params["expectedTurnId"], `${path}.expectedTurnId`),
      input: list(userContent)(params["input"], `${path}.input`),
    };
  },
};

export function isOperation(method: string): method is OperationName {
  return Object.hasOwn(validators, method);
}

export function validateParams<Name extends OperationName>(
  name: Name,
  params: unknown,
): HostParams<Name> {
  return validators[name](params, "params");
}
