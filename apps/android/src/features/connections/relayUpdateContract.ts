import { parseHostUpdateStatus, type HostUpdateStatus } from "./hostUpdateContract";

/** Adapts the Relay-owned updater contract to the shared update resource model. */
export function parseRelayUpdateStatus(value: unknown): HostUpdateStatus {
  const row = record(value, "relay update status");
  const capability = record(row.capability, "relay update capability");
  const available =
    row.availableTarget === null ? null : record(row.availableTarget, "relay target");
  return parseHostUpdateStatus({
    ...row,
    availableTarget:
      available === null
        ? null
        : {
            expiresAt: available.expiresAt,
            releaseSequence: available.releaseSequence,
            target: {
              build: available.build,
              platform: "relay-linux-x86-64",
              sourceRevision: available.sourceRevision,
              version: available.version,
            },
            targetFingerprint: available.targetFingerprint,
          },
    capability: {
      ...capability,
      guardianContractVersion: capability.updaterContractVersion,
    },
    platform: "relay-linux-x86-64",
  });
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
