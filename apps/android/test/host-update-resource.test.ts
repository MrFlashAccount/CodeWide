import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ApplyHostUpdateAccepted,
  HostUpdateOperation,
  HostUpdatePlatform,
  HostUpdateStatus,
} from "../src/features/connections/hostUpdateContract";
import { parseHostUpdateOperation } from "../src/features/connections/hostUpdateContract";
import { createHostUpdateResource } from "../src/features/connections/hostUpdateResource";
import { HostUpdateHttpError } from "../src/features/connections/hostUpdateTransport";
import { parseRelayUpdateStatus } from "../src/features/connections/relayUpdateContract";

const CURRENT_DIGEST = "a".repeat(64);
const TARGET_FINGERPRINT = "b".repeat(64);
const SOURCE_REVISION = "c".repeat(40);

afterEach(() => {
  vi.useRealTimers();
});

it("maps the Relay Updater contract into the shared update resource", () => {
  const parsed = parseRelayUpdateStatus({
    activeOperation: null,
    availableTarget: {
      build: "2",
      expiresAt: 4_000_000_000,
      releaseSequence: 2,
      sourceRevision: SOURCE_REVISION,
      targetFingerprint: TARGET_FINGERPRINT,
      version: "1.1.0",
    },
    capability: {
      apiVersion: 1,
      applySupported: true,
      bootstrapVersion: 1,
      journalVersion: 1,
      unavailableReason: null,
      updaterContractVersion: 1,
    },
    currentBuild: "1",
    currentDigest: CURRENT_DIGEST,
    currentSourceRevision: SOURCE_REVISION,
    currentVersion: "1.0.0",
  });
  expect(parsed.platform).toBe("relay-linux-x86-64");
  expect(parsed.capability.guardianContractVersion).toBe(1);
  expect(parsed.availableTarget?.target.version).toBe("1.1.0");
});

describe("Companion host update resource", () => {
  it("sanitizes guardian terminal errors before publishing them", () => {
    expect(
      parseHostUpdateOperation({
        ...operation(operationId("sanitized"), "failed"),
        errorMessage: `  verification\nfailed ${"x".repeat(400)}  `,
      }).errorMessage,
    ).toBe(`verification failed ${"x".repeat(300)}`);
  });

  it("maps a legacy 404 to unsupported instead of a broken server", async () => {
    const harness = createHarness();
    harness.transport.readStatus.mockRejectedValueOnce(
      new HostUpdateHttpError(404, "http_error", "Not found"),
    );
    harness.resource.observe("old", true);
    await settle();
    expect(harness.view("old").availability).toBe("unsupported");
    expect(harness.view("old").errorMessage).toBeNull();
  });

  it.each(["linux-x86-64", "macos-universal"] as const)(
    "projects a supported %s target",
    async (platform) => {
      const harness = createHarness();
      harness.statuses.set("server", status(platform));
      harness.resource.observe("server", true);
      await settle();
      expect(harness.view("server")).toMatchObject({
        availability: "ready",
        canApply: true,
        currentVersion: "1.0.0",
        latestVersion: "1.1.0",
        platform,
        targetFingerprint: TARGET_FINGERPRINT,
      });
    },
  );

  it("recovers a lost 202 by retrying the identical apply intent", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    harness.statuses.set("server", status("linux-x86-64"));
    harness.transport.apply
      .mockRejectedValueOnce(new Error("connection closed"))
      .mockResolvedValue({ operationId: operationId("server"), phase: "accepted" });
    harness.resource.observe("server", true);
    await settle();
    await harness.resource.apply("server", TARGET_FINGERPRINT);
    expect(harness.view("server")).toMatchObject({ disconnected: true, phase: "accepted" });
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.transport.apply).toHaveBeenCalledTimes(2);
    expect(harness.transport.apply.mock.calls[1]).toEqual(harness.transport.apply.mock.calls[0]);
    expect(harness.view("server").operationId).toBe(operationId("server"));
    harness.resource.forget("server");
  });

  it("keeps update intent through disconnect and commits only after reconnect acknowledgement", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const id = operationId("reconnect");
    harness.statuses.set("server", status("macos-universal"));
    harness.transport.apply.mockResolvedValue({ operationId: id, phase: "accepted" });
    harness.operations.set("server", operation(id, "installing"));
    harness.resource.observe("server", true);
    await settle();
    await harness.resource.apply("server", TARGET_FINGERPRINT);
    harness.resource.observe("server", false);
    expect(harness.view("server")).toMatchObject({ disconnected: true, phase: "accepted" });

    harness.operations.set("server", operation(id, "awaitingReconnect"));
    harness.transport.reconnect.mockImplementation(async () => {
      const committed = operation(id, "committed");
      harness.operations.set("server", committed);
      harness.statuses.set("server", {
        ...status("macos-universal", null),
        activeOperation: committed,
        currentVersion: "1.1.0",
      });
      return committed;
    });
    harness.resource.observe("server", true);
    await settle();
    expect(harness.transport.reconnect).toHaveBeenCalledWith("server", id);
    expect(harness.view("server")).toMatchObject({
      currentVersion: "1.1.0",
      disconnected: false,
      phase: "committed",
    });
    harness.resource.forget("server");
  });

  it("keeps a late apply acknowledgement disconnected until the device reconnects", async () => {
    const harness = createHarness();
    const acceptance = Promise.withResolvers<ApplyHostUpdateAccepted>();
    harness.statuses.set("server", status("linux-x86-64"));
    harness.transport.apply.mockReturnValueOnce(acceptance.promise);
    harness.resource.observe("server", true);
    await settle();
    const applying = harness.resource.apply("server", TARGET_FINGERPRINT);
    harness.resource.observe("server", false);
    acceptance.resolve({ operationId: operationId("late"), phase: "accepted" });
    await applying;
    expect(harness.view("server")).toMatchObject({
      disconnected: true,
      operationId: operationId("late"),
      phase: "accepted",
    });
    harness.resource.forget("server");
  });

  it("keeps polling a known operation after a rejected reconnect receipt", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const id = operationId("receipt");
    harness.statuses.set("server", status("macos-universal"));
    harness.transport.apply.mockResolvedValue({ operationId: id, phase: "accepted" });
    harness.operations.set("server", operation(id, "awaitingReconnect"));
    harness.transport.reconnect
      .mockRejectedValueOnce(
        new HostUpdateHttpError(412, "invalid_reconnect_receipt", "Receipt is not fresh yet"),
      )
      .mockImplementation(async () => {
        const committed = operation(id, "committed");
        harness.operations.set("server", committed);
        harness.statuses.set("server", {
          ...status("macos-universal", null),
          activeOperation: committed,
          currentVersion: "1.1.0",
        });
        return committed;
      });
    harness.resource.observe("server", true);
    await settle();
    await harness.resource.apply("server", TARGET_FINGERPRINT);
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.view("server")).toMatchObject({
      disconnected: true,
      operationId: id,
      phase: "awaitingReconnect",
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.view("server")).toMatchObject({
      currentVersion: "1.1.0",
      disconnected: false,
      phase: "committed",
    });
    harness.resource.forget("server");
  });

  it("does not republish a status request after the connection is forgotten", async () => {
    const harness = createHarness();
    const pending = Promise.withResolvers<HostUpdateStatus>();
    harness.transport.readStatus.mockReturnValueOnce(pending.promise);
    harness.resource.observe("server", true);
    harness.resource.forget("server");
    pending.resolve(status("linux-x86-64"));
    await settle();
    expect(harness.resource.snapshot$.byConnection.server?.peek()).toBeUndefined();
  });

  it.each([
    ["rolledBack", "guardian_health_failed", "New Companion did not reconnect"],
    ["failed", "artifact_invalid", "Downloaded artifact failed verification"],
  ] as const)("retains the durable %s outcome and guardian error", async (phase, code, message) => {
    const harness = createHarness();
    const terminal = operation(operationId(phase), phase, code, message);
    harness.statuses.set("server", {
      ...status("linux-x86-64"),
      activeOperation: terminal,
    });
    harness.resource.observe("server", true);
    await settle();
    expect(harness.view("server")).toMatchObject({
      canRetry: true,
      errorCode: code,
      errorMessage: message,
      phase,
    });
  });

  it.each([
    [409, "operation_conflict", "Another update is active", "error"],
    [412, "precondition_failed", "Target fingerprint is stale", "error"],
    [423, "update_locked", "Guardian is locked", "error"],
    [412, "manual_update_required", "manual_bootstrap_required", "manualBootstrap"],
  ] as const)(
    "maps HTTP %s/%s without losing the server",
    async (httpStatus, code, message, availability) => {
      const harness = createHarness();
      harness.statuses.set("server", status("linux-x86-64"));
      harness.transport.apply.mockRejectedValueOnce(
        new HostUpdateHttpError(httpStatus, code, message),
      );
      harness.resource.observe("server", true);
      await settle();
      await harness.resource.apply("server", TARGET_FINGERPRINT);
      expect(harness.view("server")).toMatchObject({
        availability,
        canRetry: false,
        errorCode: code === "precondition_failed" ? "stale_target" : code,
        phase: null,
      });
    },
  );

  it("rejects a stale shown fingerprint without sending apply", async () => {
    const harness = createHarness();
    harness.statuses.set("server", status("linux-x86-64"));
    harness.resource.observe("server", true);
    await settle();
    await harness.resource.apply("server", "d".repeat(64));
    expect(harness.transport.apply).not.toHaveBeenCalled();
    expect(harness.view("server")).toMatchObject({
      canCheck: true,
      errorCode: "stale_target",
    });
  });

  it("isolates simultaneous servers", async () => {
    const harness = createHarness();
    harness.statuses.set("mac", status("macos-universal"));
    harness.statuses.set("linux", status("linux-x86-64", null));
    harness.resource.observe("mac", true);
    harness.resource.observe("linux", true);
    await settle();
    expect(harness.view("mac").latestVersion).toBe("1.1.0");
    expect(harness.view("linux").latestVersion).toBeNull();
    harness.resource.observe("mac", false);
    expect(harness.view("linux").disconnected).toBe(false);
  });
});

function createHarness() {
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
  const resource = createHostUpdateResource({
    createIdempotencyKey: () => "00000000-0000-4000-8000-000000000001",
    retryBaseMilliseconds: 1,
    transport,
  });
  return {
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

function status(
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

function operation(
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
  };
}

function operationId(suffix: string): string {
  return `operation-${suffix.padEnd(20, "0")}`;
}

function requireValue<T>(values: ReadonlyMap<string, T>, key: string): T {
  const value = values.get(key);
  if (value === undefined) throw new Error(`Missing fake value for ${key}`);
  return value;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
