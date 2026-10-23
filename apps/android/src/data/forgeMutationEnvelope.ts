import { unknownRecord } from "./unknownRecord";

/** Forge/review writes whose exact payload may be persisted and replayed. */
const DURABLE_FORGE_METHODS = [
  "companion/pullRequest/action/run",
  "companion/pullRequest/links/set",
  "companion/pullRequest/review/submit",
  "companion/pullRequest/scenario/start",
  "companion/pullRequest/viewed/set",
  "companion/review/draft/put",
  "companion/review/draft/sendToAgent",
  "companion/review/guide/request",
  "companion/review/guide/stop/set",
] as const;

export type DurableForgeMethod = (typeof DURABLE_FORGE_METHODS)[number];

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonArray | JsonObject;
type JsonArray = readonly JsonValue[];
type JsonObject = {
  readonly [key: string]: JsonValue;
};

/** Exact replay envelope created before its first transport attempt. */
export type ForgeMutationEnvelope = {
  readonly connectionId: string;
  readonly method: DurableForgeMethod;
  readonly operationId: string;
  readonly params: JsonObject;
  readonly scope: string;
  readonly version: 1;
};

type JsonCopyResult =
  | { readonly status: "invalid" }
  | { readonly status: "valid"; readonly value: JsonValue };

const INVALID_JSON: JsonCopyResult = { status: "invalid" };
const MAX_JSON_DEPTH = 32;
const MAX_CONNECTION_ID_LENGTH = 512;
const MAX_OPERATION_ID_LENGTH = 160;
const MAX_SCOPE_LENGTH = 1024;

function copyObject(record: Readonly<Record<string, unknown>>, depth: number): JsonObject | null {
  const result: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(record)) {
    const copied = copyJson(item, depth + 1);
    if (copied.status === "invalid") {
      return null;
    }
    result[key] = copied.value;
  }
  return result;
}

function copyArray(values: readonly unknown[], depth: number): JsonCopyResult {
  const result: JsonValue[] = [];
  for (const item of values) {
    const copied = copyJson(item, depth + 1);
    if (copied.status === "invalid") {
      return INVALID_JSON;
    }
    result.push(copied.value);
  }
  return { status: "valid", value: result };
}

function copyPrimitive(value: unknown): JsonCopyResult | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return { status: "valid", value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? { status: "valid", value } : INVALID_JSON;
  }
  return undefined;
}

function copyJson(value: unknown, depth: number): JsonCopyResult {
  const primitive = copyPrimitive(value);
  if (primitive !== undefined) {
    return primitive;
  }
  if (depth >= MAX_JSON_DEPTH) {
    return INVALID_JSON;
  }
  if (Array.isArray(value)) {
    return copyArray(value, depth);
  }
  const record = unknownRecord(value);
  if (record === null) {
    return INVALID_JSON;
  }
  const copied = copyObject(record, depth);
  return copied === null ? INVALID_JSON : { status: "valid", value: copied };
}

function durableMethod(value: unknown): DurableForgeMethod | null {
  return typeof value === "string"
    ? (DURABLE_FORGE_METHODS.find((candidate) => candidate === value) ?? null)
    : null;
}

function boundedText(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : null;
}

/** Validates a new mutation and captures an immutable JSON snapshot of its transport payload. */
export function createForgeMutationEnvelope(input: {
  readonly connectionId: string;
  readonly method: DurableForgeMethod;
  readonly operationId: string;
  readonly params: unknown;
  readonly scope: string;
}): ForgeMutationEnvelope {
  const rawParams = unknownRecord(input.params);
  const params = rawParams === null ? null : copyObject(rawParams, 0);
  if (
    boundedText(input.connectionId, MAX_CONNECTION_ID_LENGTH) === null ||
    boundedText(input.operationId, MAX_OPERATION_ID_LENGTH) === null ||
    boundedText(input.scope, MAX_SCOPE_LENGTH) === null ||
    params === null
  ) {
    throw new Error("Invalid durable forge mutation");
  }
  return {
    connectionId: input.connectionId,
    method: input.method,
    operationId: input.operationId,
    params,
    scope: input.scope,
    version: 1,
  };
}

/** Re-validates a mutation restored from device storage. */
export function parseForgeMutationEnvelope(value: unknown): ForgeMutationEnvelope | null {
  const record = unknownRecord(value);
  if (record === null || record.version !== 1) {
    return null;
  }
  const connectionId = boundedText(record.connectionId, MAX_CONNECTION_ID_LENGTH);
  const method = durableMethod(record.method);
  const operationId = boundedText(record.operationId, MAX_OPERATION_ID_LENGTH);
  const scope = boundedText(record.scope, MAX_SCOPE_LENGTH);
  if (connectionId === null || method === null || operationId === null || scope === null) {
    return null;
  }
  try {
    return createForgeMutationEnvelope({
      connectionId,
      method,
      operationId,
      params: record.params,
      scope,
    });
  } catch {
    return null;
  }
}
