import {
  fingerprintV2Command,
  validateV2ContractDefinition,
  type V2Command,
  type V2PersistedOperation,
  type V2Projection,
} from "@codewide/sync-client/v2";

const PROJECTION_KEYS = [
  "generationId",
  "sourceGeneration",
  "epochId",
  "revision",
  "watermark",
  "scope",
  "limits",
  "catalog",
  "currentThread",
  "pendingRequests",
  "resourceRevisions",
  "queueRevisions",
  "accountsRevision",
  "invalidations",
] as const;

const OPERATION_KEYS = [
  "operationId",
  "command",
  "commandKind",
  "commandFingerprint",
  "state",
  "terminalClass",
  "createdAtMs",
  "updatedAtMs",
  "acceptedAt",
] as const;

const OPERATION_STATES = [
  "created",
  "sent",
  "accepted",
  "completed",
  "failed",
  "indeterminate",
  "rejected",
  "expired",
] as const;

const TERMINAL_STATES = ["completed", "failed", "indeterminate", "rejected", "expired"] as const;

const COMMAND_KINDS: Record<V2Command["kind"], true> = {
  "account.login.cancel": true,
  "account.login.start": true,
  "account.update": true,
  "process.terminate": true,
  "project.add": true,
  "queue.mutate": true,
  "request.resolve": true,
  "review.start": true,
  "thread.compact": true,
  "thread.create": true,
  "thread.delete": true,
  "thread.fork": true,
  "thread.markRead": true,
  "thread.rollback": true,
  "thread.update": true,
  "turn.interrupt": true,
  "turn.steer": true,
  "turn.submit": true,
  "workspace.create": true,
};

const INVALIDATION_KINDS = [
  "resourcesChanged",
  "queueChanged",
  "accountsChanged",
  "threadGoalChanged",
  "skillsChanged",
] as const;

type UnknownRecord = Readonly<Record<string, unknown>>;

export function parsePersistedProjection(payload: unknown): V2Projection | null {
  const value = parseJson(payload);
  if (!isRecord(value) || !hasExactKeys(value, PROJECTION_KEYS)) return null;
  try {
    validateV2ContractDefinition("id", read(value, "epochId"));
    validateV2ContractDefinition("u64", read(value, "sourceGeneration"));
    validateV2ContractDefinition("u64", read(value, "watermark"));
    validateV2ContractDefinition("catalogScope", read(value, "scope"));
    validateV2ContractDefinition("snapshotLimits", read(value, "limits"));
    const epochId = read(value, "epochId");
    const revision = read(value, "revision");
    const generationId = read(value, "generationId");
    if (
      typeof epochId !== "string" ||
      typeof revision !== "string" ||
      !revision.startsWith("sync-v2-revision:") ||
      typeof generationId !== "string" ||
      generationId !== `${epochId}:${revision}`
    )
      return null;
    if (!validCatalog(read(value, "catalog"))) return null;
    const currentThread = read(value, "currentThread");
    if (currentThread !== null) validateV2ContractDefinition("threadWindow", currentThread);
    const pendingRequests = read(value, "pendingRequests");
    if (!validDefinitionArray(pendingRequests, "pendingRequest")) return null;
    if (!validRevisionMap(read(value, "resourceRevisions"))) return null;
    if (!validRevisionMap(read(value, "queueRevisions"))) return null;
    const accountsRevision = read(value, "accountsRevision");
    if (accountsRevision !== null && typeof accountsRevision !== "string") return null;
    const invalidations = read(value, "invalidations");
    if (!validInvalidations(invalidations)) return null;
  } catch {
    return null;
  }
  // WHY: every field and nested wire value was validated above, while the generated contract
  // deliberately has no definition for the client-owned durable projection envelope.
  return value as V2Projection;
}

export function parsePersistedOperation(
  payload: unknown,
  expectedOperationId: string,
): V2PersistedOperation | null {
  const value = parseJson(payload);
  if (!isRecord(value) || !hasExactKeys(value, OPERATION_KEYS)) return null;
  try {
    const operationId = read(value, "operationId");
    validateV2ContractDefinition("operationId", operationId);
    if (operationId !== expectedOperationId) return null;
    const commandValue = read(value, "command");
    const commandKind = read(value, "commandKind");
    const commandFingerprint = read(value, "commandFingerprint");
    const state = read(value, "state");
    const terminalClass = read(value, "terminalClass");
    const createdAtMs = read(value, "createdAtMs");
    const updatedAtMs = read(value, "updatedAtMs");
    const acceptedAt = read(value, "acceptedAt");
    if (!isOneOf(state, OPERATION_STATES) || !isCommandKind(commandKind)) return null;
    if (typeof commandFingerprint !== "string" || !/^[0-9a-f]{64}$/u.test(commandFingerprint))
      return null;
    if (!validTimestampNumber(createdAtMs) || !validTimestampNumber(updatedAtMs)) return null;
    if (updatedAtMs < createdAtMs) return null;
    if (acceptedAt !== null) validateV2ContractDefinition("timestamp", acceptedAt);
    const terminal = isOneOf(state, TERMINAL_STATES);
    if ((terminal && terminalClass !== state) || (!terminal && terminalClass !== null)) return null;
    const retainsCommand = state === "created" || state === "sent";
    if (retainsCommand !== (commandValue !== null)) return null;
    if (commandValue !== null) {
      validateV2ContractDefinition("command", commandValue);
      // WHY: generated validation above proves the external value is a closed V2 command.
      const command = commandValue as V2Command;
      if (command.kind !== commandKind || fingerprintV2Command(command) !== commandFingerprint)
        return null;
    }
    if (state === "accepted" && acceptedAt === null) return null;
    if (["completed", "failed", "indeterminate"].includes(state) && acceptedAt === null)
      return null;
    if (
      (state === "created" || state === "sent" || state === "rejected" || state === "expired") &&
      acceptedAt !== null
    )
      return null;
  } catch {
    return null;
  }
  // WHY: the durable envelope was checked field-by-field and its command through the generated
  // contract; no generated definition exists for this client-only operation record.
  return value as V2PersistedOperation;
}

function parseJson(payload: unknown): unknown {
  if (typeof payload !== "string") return null;
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}

function validCatalog(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  for (const entry of value) {
    if (!isRecord(entry) || !hasExactKeys(entry, ["thread", "coverage"])) return false;
    const coverage = read(entry, "coverage");
    if (coverage !== "current" && coverage !== "outsideCurrentScope") return false;
    validateV2ContractDefinition("threadSummary", read(entry, "thread"));
  }
  return true;
}

function validInvalidations(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  for (const invalidation of value) {
    if (!isRecord(invalidation)) return false;
    const watermark = read(invalidation, "watermark");
    const kind = read(invalidation, "kind");
    validateV2ContractDefinition("u64", watermark);
    if (!isOneOf(kind, INVALIDATION_KINDS)) return false;
    const change: Record<string, unknown> = {};
    for (const key of Object.keys(invalidation)) {
      if (key !== "watermark") change[key] = read(invalidation, key);
    }
    validateV2ContractDefinition("projectionChange", change);
  }
  return true;
}

function validDefinitionArray(
  value: unknown,
  definition: Parameters<typeof validateV2ContractDefinition>[0],
): boolean {
  if (!Array.isArray(value)) return false;
  for (const entry of value) validateV2ContractDefinition(definition, entry);
  return true;
}

function validRevisionMap(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).every((entry) => {
    const key = entry[0];
    const revision = entry[1];
    return key.length > 0 && typeof revision === "string" && revision.length > 0;
  });
}

function validTimestampNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function read(value: UnknownRecord, key: string): unknown {
  return Reflect.get(value, key);
}

function hasExactKeys(value: UnknownRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  const expectedKeys = new Set(expected);
  return keys.length === expected.length && keys.every((key) => expectedKeys.has(key));
}

function isOneOf<const Value extends string>(
  value: unknown,
  choices: readonly Value[],
): value is Value {
  return typeof value === "string" && choices.some((choice) => choice === value);
}

function isCommandKind(value: unknown): value is V2Command["kind"] {
  return typeof value === "string" && Object.hasOwn(COMMAND_KINDS, value);
}
