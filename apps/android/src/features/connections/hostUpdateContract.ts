const SHA256_HEX_LENGTH = 64;
const SHA1_HEX_LENGTH = 40;
const OPAQUE_ID_MIN_LENGTH = 20;
const OPAQUE_ID_MAX_LENGTH = 128;
const MAX_ERROR_MESSAGE_LENGTH = 320;

/** Supported host identifiers from the private Companion host-update V1 contract. */
export type HostUpdatePlatform = "linux-x86-64" | "macos-universal" | "relay-linux-x86-64";

/** Durable update phases reported by the platform guardian. */
export type HostUpdatePhase =
  | "accepted"
  | "installing"
  | "targetReady"
  | "awaitingReconnect"
  | "committed"
  | "rollingBack"
  | "rolledBack"
  | "failed";

/** Guardian compatibility values that gate remote apply. */
type HostUpdateCapability = {
  readonly apiVersion: number;
  readonly applySupported: boolean;
  readonly bootstrapVersion: number;
  readonly guardianContractVersion: number;
  readonly journalVersion: number;
  readonly unavailableReason: string | null;
};

/** Signed release fields presented by Settings. */
type HostUpdateTarget = {
  readonly build: string;
  readonly platform: HostUpdatePlatform;
  readonly sourceRevision: string;
  readonly version: string;
};

/** Exact signed target currently eligible for apply. */
export type AvailableHostUpdate = {
  readonly expiresAt: number;
  readonly releaseSequence: number;
  readonly target: HostUpdateTarget;
  readonly targetFingerprint: string;
};

/** Durable operation projection used across the expected restart. */
export type HostUpdateOperation = {
  readonly currentVersion: string;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly operationId: string;
  readonly phase: HostUpdatePhase;
  readonly startedAt: number;
  readonly targetFingerprint: string;
  readonly targetVersion: string;
  readonly updatedAt: number;
};

/** Current host, capability, release and operation read model. */
export type HostUpdateStatus = {
  readonly activeOperation: HostUpdateOperation | null;
  readonly availableTarget: AvailableHostUpdate | null;
  readonly capability: HostUpdateCapability;
  readonly currentBuild: string;
  /** `null` when the host runs a build that was never installed from a signed release. */
  readonly currentDigest: string | null;
  readonly currentSourceRevision: string;
  readonly currentVersion: string;
  readonly platform: HostUpdatePlatform;
};

/** Journal-persisted apply acknowledgement. */
export type ApplyHostUpdateAccepted = {
  readonly operationId: string;
  readonly phase: "accepted";
};

/** Rejects partial or drifted status responses before they enter the render resource. */
export function parseHostUpdateStatus(value: unknown): HostUpdateStatus {
  const row = record(value, "host update status");
  return {
    activeOperation:
      row.activeOperation === null ? null : parseHostUpdateOperation(row.activeOperation),
    availableTarget:
      row.availableTarget === null ? null : parseAvailableHostUpdate(row.availableTarget),
    capability: parseCapability(row.capability),
    currentBuild: text(row.currentBuild, "currentBuild"),
    currentDigest:
      row.currentDigest === null
        ? null
        : hex(row.currentDigest, SHA256_HEX_LENGTH, "currentDigest"),
    currentSourceRevision: hex(row.currentSourceRevision, SHA1_HEX_LENGTH, "currentSourceRevision"),
    currentVersion: text(row.currentVersion, "currentVersion"),
    platform: platform(row.platform),
  };
}

/** Rejects partial or drifted operation responses before reconciliation. */
export function parseHostUpdateOperation(value: unknown): HostUpdateOperation {
  const row = record(value, "host update operation");
  return {
    currentVersion: text(row.currentVersion, "currentVersion"),
    errorCode: nullableText(row.errorCode, "errorCode"),
    errorMessage: sanitizedNullableText(row.errorMessage, "errorMessage"),
    operationId: opaqueId(row.operationId, "operationId"),
    phase: phase(row.phase),
    startedAt: finiteNumber(row.startedAt, "startedAt"),
    targetFingerprint: hex(row.targetFingerprint, SHA256_HEX_LENGTH, "targetFingerprint"),
    targetVersion: text(row.targetVersion, "targetVersion"),
    updatedAt: finiteNumber(row.updatedAt, "updatedAt"),
  };
}

/** Parses the durable acknowledgement returned only after journal persistence. */
export function parseApplyHostUpdateAccepted(value: unknown): ApplyHostUpdateAccepted {
  const row = record(value, "host update acceptance");
  if (row.phase !== "accepted") {
    throw new Error("Host update acceptance has an invalid phase");
  }
  return { operationId: opaqueId(row.operationId, "operationId"), phase: "accepted" };
}

export function isTerminalHostUpdatePhase(phaseValue: HostUpdatePhase): boolean {
  return phaseValue === "committed" || phaseValue === "rolledBack" || phaseValue === "failed";
}

function parseCapability(value: unknown): HostUpdateCapability {
  const row = record(value, "host update capability");
  if (typeof row.applySupported !== "boolean") {
    throw new Error("Host update capability applySupported is invalid");
  }
  return {
    apiVersion: integer(row.apiVersion, "apiVersion"),
    applySupported: row.applySupported,
    bootstrapVersion: integer(row.bootstrapVersion, "bootstrapVersion"),
    guardianContractVersion: integer(row.guardianContractVersion, "guardianContractVersion"),
    journalVersion: integer(row.journalVersion, "journalVersion"),
    unavailableReason: nullableText(row.unavailableReason, "unavailableReason"),
  };
}

function parseAvailableHostUpdate(value: unknown): AvailableHostUpdate {
  const row = record(value, "available host update");
  const target = record(row.target, "host update target");
  return {
    expiresAt: finiteNumber(row.expiresAt, "expiresAt"),
    releaseSequence: integer(row.releaseSequence, "releaseSequence"),
    target: {
      build: text(target.build, "target.build"),
      platform: platform(target.platform),
      sourceRevision: hex(target.sourceRevision, SHA1_HEX_LENGTH, "target.sourceRevision"),
      version: text(target.version, "target.version"),
    },
    targetFingerprint: hex(row.targetFingerprint, SHA256_HEX_LENGTH, "targetFingerprint"),
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Host update ${label} is invalid`);
  }
  return value;
}

function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : text(value, label);
}

function sanitizedNullableText(value: unknown, label: string): string | null {
  const parsed = nullableText(value, label);
  if (parsed === null) {
    return null;
  }
  const compact = parsed.replaceAll(/\s+/gu, " ").trim().slice(0, MAX_ERROR_MESSAGE_LENGTH);
  return compact.length === 0 ? "Companion update failed" : compact;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Host update ${label} is invalid`);
  }
  return value;
}

function integer(value: unknown, label: string): number {
  const parsed = finiteNumber(value, label);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Host update ${label} is invalid`);
  }
  return parsed;
}

function hex(value: unknown, length: number, label: string): string {
  const parsed = text(value, label);
  if (parsed.length !== length || !/^[0-9a-f]+$/u.test(parsed)) {
    throw new Error(`Host update ${label} is invalid`);
  }
  return parsed;
}

function opaqueId(value: unknown, label: string): string {
  const parsed = text(value, label);
  if (
    parsed.length < OPAQUE_ID_MIN_LENGTH ||
    parsed.length > OPAQUE_ID_MAX_LENGTH ||
    !/^[A-Za-z0-9_-]+$/u.test(parsed)
  ) {
    throw new Error(`Host update ${label} is invalid`);
  }
  return parsed;
}

function phase(value: unknown): HostUpdatePhase {
  switch (value) {
    case "accepted":
    case "installing":
    case "targetReady":
    case "awaitingReconnect":
    case "committed":
    case "rollingBack":
    case "rolledBack":
    case "failed":
      return value;
    default:
      throw new Error("Host update phase is invalid");
  }
}

function platform(value: unknown): HostUpdatePlatform {
  switch (value) {
    case "linux-x86-64":
    case "macos-universal":
    case "relay-linux-x86-64":
      return value;
    default:
      throw new Error("Host update platform is invalid");
  }
}
