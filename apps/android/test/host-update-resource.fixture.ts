import { vi } from "vitest";

import type {
  ApplyHostUpdateAccepted,
  HostUpdateOperation,
  HostUpdatePlatform,
  HostUpdateStatus,
} from "../src/features/connections/hostUpdateContract";
import { createHostUpdateResource } from "../src/features/connections/hostUpdateResource";

export const CURRENT_DIGEST = "a".repeat(64);
export const TARGET_FINGERPRINT = "b".repeat(64);
export const SOURCE_REVISION = "c".repeat(40);

/** A resource over a scripted transport and a manual clock. */
export function createHarness() {
  const statuses = new Map<string, HostUpdateStatus>();
  const operations = new Map<string, HostUpdateOperation>();
  const transport = {
    apply:
      vi.fn<
        (
          connectionId: string,
          targetFingerprint: string,
          idempotencyKey: string,
        ) => Promise<ApplyHostUpdateAccepted>
      >(),
    check: vi.fn(async (connectionId: string) => requireValue(statuses, connectionId)),
    readOperation: vi.fn(async (connectionId: string) => requireValue(operations, connectionId)),
    readStatus: vi.fn(async (connectionId: string) => requireValue(statuses, connectionId)),
    reconnect: vi.fn(async (connectionId: string) => requireValue(operations, connectionId)),
  };
  transport.apply.mockImplementation(async (_connectionId, _fingerprint, idempotencyKey) => ({
    operationId: `operation-${idempotencyKey}`.slice(0, 128),
    phase: "accepted",
  }));
  let clock = 0;
  const resource = createHostUpdateResource({
    createIdempotencyKey: () => "00000000-0000-4000-8000-000000000001",
    now: () => clock,
    retryBaseMilliseconds: 1,
    transport,
  });
  return {
    advance(milliseconds: number) {
      clock += milliseconds;
    },
    operations,
    resource,
    statuses,
    transport,
    view(connectionId: string) {
      const view = resource.snapshot$.byConnection[connectionId]?.peek();
      if (view === undefined) throw new Error(`Missing view for ${connectionId}`);
      return view;
    },
  };
}

export function status(
  platform: HostUpdatePlatform,
  target: "available" | null = "available",
): HostUpdateStatus {
  return {
    activeOperation: null,
    availableTarget:
      target === null
        ? null
        : {
            expiresAt: 4_000_000_000,
            releaseSequence: 2,
            target: {
              build: "2",
              platform,
              sourceRevision: SOURCE_REVISION,
              version: "1.1.0",
            },
            targetFingerprint: TARGET_FINGERPRINT,
          },
    capability: {
      apiVersion: 1,
      applySupported: true,
      bootstrapVersion: 1,
      guardianContractVersion: 1,
      journalVersion: 1,
      unavailableReason: null,
    },
    currentBuild: "1",
    currentDigest: CURRENT_DIGEST,
    currentSourceRevision: SOURCE_REVISION,
    currentVersion: "1.0.0",
    platform,
  };
}

export function operation(
  id: string,
  phase: HostUpdateOperation["phase"],
  errorCode: string | null = null,
  errorMessage: string | null = null,
): HostUpdateOperation {
  return {
    currentVersion: "1.0.0",
    errorCode,
    errorMessage,
    operationId: id,
    phase,
    startedAt: 1,
    targetFingerprint: TARGET_FINGERPRINT,
    targetVersion: "1.1.0",
    updatedAt: 2,
    progress: null,
  };
}

export function operationId(suffix: string): string {
  return `operation-${suffix.padEnd(20, "0")}`;
}

function requireValue<T>(values: ReadonlyMap<string, T>, key: string): T {
  const value = values.get(key);
  if (value === undefined) throw new Error(`Missing fake value for ${key}`);
  return value;
}

export async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
