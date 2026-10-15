import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ApplyHostUpdateAccepted,
  HostUpdateStatus,
} from "../src/features/connections/hostUpdateContract";
import { parseHostUpdateOperation } from "../src/features/connections/hostUpdateContract";
import { HostUpdateHttpError } from "../src/features/connections/hostUpdateTransport";
import { parseRelayUpdateStatus } from "../src/features/connections/relayUpdateContract";
import {
  CURRENT_DIGEST,
  createHarness,
  operation,
  operationId,
  settle,
  SOURCE_REVISION,
  status,
  TARGET_FINGERPRINT,
} from "./host-update-resource.fixture";

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

it("keeps a Relay without Relay Updater visible as a manual setup state", async () => {
  // Relay reports this exact shape before its updater installs a signed release.
  const parsed = parseRelayUpdateStatus({
    activeOperation: null,
    availableTarget: null,
    capability: {
      apiVersion: 1,
      applySupported: false,
      bootstrapVersion: 0,
      journalVersion: 0,
      unavailableReason: "manual_bootstrap_required",
      updaterContractVersion: 0,
    },
    currentBuild: "000000000000",
    currentDigest: "",
    currentSourceRevision: "0".repeat(40),
    currentVersion: "0.4.2",
  });
  const harness = createHarness();
  harness.statuses.set("server", parsed);
  harness.resource.observe("server", true);
  await settle();
  expect(harness.view("server")).toMatchObject({
    availability: "manualBootstrap",
    canApply: false,
    currentVersion: "0.4.2",
  });
});

it("reports a build without embedded release trust as unofficial, not as missing setup", async () => {
  const harness = createHarness();
  const official = status("linux-x86-64", null);
  harness.statuses.set("server", {
    ...official,
    capability: { ...official.capability, applySupported: false, unavailableReason: "unofficial_build" },
  });
  harness.resource.observe("server", true);
  await settle();
  expect(harness.view("server")).toMatchObject({
    availability: "unofficialBuild",
    canApply: false,
    currentVersion: "1.0.0",
  });
});

describe("Companion host update resource", () => {
  it("retains a terminal failure when the subsequent legacy status omits it", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    harness.statuses.set("server", status("linux-x86-64"));
    harness.resource.observe("server", true);
    await settle();
    await harness.resource.apply("server", TARGET_FINGERPRINT);
    const id = harness.view("server").operationId;
    if (id === null) throw new Error("Missing accepted operation");
    harness.operations.set("server", operation(id, "failed", "download_failed", "The signed update could not be downloaded."));
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.view("server")).toMatchObject({ phase: "failed", canRetry: true, canCheck: true, errorCode: "download_failed" });
    harness.resource.forget("server");
  });

  it("lets a retained terminal failure expire like the guardian's retention", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    harness.statuses.set("server", status("linux-x86-64"));
    harness.resource.observe("server", true);
    await settle();
    await harness.resource.apply("server", TARGET_FINGERPRINT);
    const id = harness.view("server").operationId;
    if (id === null) throw new Error("Missing accepted operation");
    harness.operations.set("server", operation(id, "failed", "download_failed", "The signed update could not be downloaded."));
    await vi.advanceTimersByTimeAsync(1);

    harness.advance(59 * 60_000);
    harness.resource.observe("server", true);
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.view("server")).toMatchObject({ phase: "failed", errorCode: "download_failed" });

    harness.advance(60_000);
    harness.resource.observe("server", true);
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.view("server")).toMatchObject({ phase: null, errorCode: null, errorMessage: null });
    harness.resource.forget("server");
  });

  it("drops a retained terminal failure when the user checks again", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    harness.statuses.set("server", status("linux-x86-64"));
    harness.resource.observe("server", true);
    await settle();
    await harness.resource.apply("server", TARGET_FINGERPRINT);
    const id = harness.view("server").operationId;
    if (id === null) throw new Error("Missing accepted operation");
    harness.operations.set("server", operation(id, "failed", "download_failed", "The signed update could not be downloaded."));
    await vi.advanceTimersByTimeAsync(1);

    await harness.resource.check("server");
    expect(harness.view("server")).toMatchObject({ phase: null, errorCode: null, errorMessage: null });
    harness.resource.forget("server");
  });

  it("publishes received download progress and replaces it with the durable failure", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const pending = { ...operation(operationId("progress"), "installing"), progress: { stage: "downloading", downloadedBytes: 512, totalBytes: 1024 } as const };
    harness.statuses.set("server", { ...status("linux-x86-64"), activeOperation: pending });
    harness.resource.observe("server", true);
    await settle();
    expect(harness.view("server").progress).toEqual(pending.progress);
    harness.operations.set("server", operation(pending.operationId, "failed", "download_failed", "Download interrupted"));
    harness.statuses.set("server", status("linux-x86-64"));
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.view("server")).toMatchObject({ phase: "failed", progress: null, disconnected: false, errorMessage: "Download interrupted" });
    harness.resource.forget("server");
  });

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
    // Not acknowledged yet: the request stays pending instead of claiming acceptance.
    expect(harness.view("server")).toMatchObject({ disconnected: true, pending: "apply", phase: null });
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
        errorMessage: availability === "error" ? message : null,
        pending: null,
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

  it("rereads a status left stale by a restart no settings surface observed", async () => {
    const harness = createHarness();
    harness.statuses.set("server", status("linux-x86-64"));
    harness.resource.observe("server", true);
    await settle();
    expect(harness.view("server").currentVersion).toBe("1.0.0");

    // Companion was updated while settings were closed; no disconnect was observed.
    harness.statuses.set("server", { ...status("linux-x86-64", null), currentVersion: "1.1.0" });
    harness.advance(29_999);
    harness.resource.observe("server", true);
    await settle();
    expect(harness.view("server").currentVersion).toBe("1.0.0");

    harness.advance(1);
    harness.resource.observe("server", true);
    await settle();
    expect(harness.view("server")).toMatchObject({ currentVersion: "1.1.0", latestVersion: null });
  });

  it("does not repeat a failed status read on every render", async () => {
    const harness = createHarness();
    harness.transport.readStatus.mockRejectedValue(new Error("Companion is unreachable"));
    harness.resource.observe("server", true);
    await settle();
    harness.resource.observe("server", true);
    harness.resource.observe("server", true);
    await settle();
    expect(harness.transport.readStatus).toHaveBeenCalledOnce();
    expect(harness.view("server")).toMatchObject({
      errorCode: "transport_error",
      errorMessage: "Companion is unreachable",
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
