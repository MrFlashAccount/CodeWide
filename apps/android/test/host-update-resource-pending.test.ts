import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostUpdateStatus } from "../src/features/connections/hostUpdateContract";
import { intentAfterStatus } from "../src/features/connections/hostUpdateResourceState";
import {
  HostUpdateHttpError,
  HostUpdateUnreachableError,
} from "../src/features/connections/hostUpdateTransport";
import {
  createHarness,
  operation,
  operationId,
  settle,
  status,
  TARGET_FINGERPRINT,
} from "./host-update-resource.fixture";

afterEach(() => {
  vi.useRealTimers();
});

async function observedHarness() {
  const harness = createHarness();
  harness.statuses.set("server", status("macos-universal"));
  harness.resource.observe("server", true);
  await settle();
  return harness;
}

/** Starts a demand reread that stays in flight until the returned resolver runs. */
function startStaleRead(harness: ReturnType<typeof createHarness>) {
  const read = Promise.withResolvers<HostUpdateStatus>();
  harness.transport.readStatus.mockReturnValueOnce(read.promise);
  harness.advance(30_000);
  harness.resource.observe("server", true);
  return read;
}

describe("pending host update requests", () => {
  it("shows Update as pending at once and keeps it pending through a concurrent read", async () => {
    vi.useFakeTimers();
    const harness = await observedHarness();
    const read = startStaleRead(harness);

    const applying = harness.resource.apply("server", TARGET_FINGERPRINT);
    expect(harness.view("server")).toMatchObject({ canApply: false, pending: "apply", phase: null });

    read.resolve(status("macos-universal"));
    await applying;
    await settle();
    // The older read must not offer Update again for the intent being sent.
    expect(harness.view("server")).toMatchObject({ canApply: false, pending: "apply" });

    await vi.advanceTimersByTimeAsync(0);
    expect(harness.transport.apply).toHaveBeenCalledOnce();
    expect(harness.view("server")).toMatchObject({ pending: null, phase: "accepted" });
    harness.resource.forget("server");
  });

  it("ends a rejected apply with the server's error instead of a pending state", async () => {
    const harness = await observedHarness();
    harness.transport.apply.mockRejectedValueOnce(
      new HostUpdateHttpError(409, "operation_conflict", "Another update is active"),
    );
    await harness.resource.apply("server", TARGET_FINGERPRINT);
    expect(harness.view("server")).toMatchObject({
      errorMessage: "Another update is active",
      pending: null,
      phase: null,
    });
  });

  it("runs a check requested during a background read right after that read", async () => {
    const harness = await observedHarness();
    const read = startStaleRead(harness);

    const checking = harness.resource.check("server");
    expect(harness.view("server")).toMatchObject({ canCheck: false, pending: "check" });
    await settle();
    expect(harness.transport.check).not.toHaveBeenCalled();

    read.resolve(status("macos-universal"));
    await checking;
    expect(harness.transport.check).toHaveBeenCalledOnce();
    expect(harness.view("server")).toMatchObject({ canCheck: true, pending: null });
  });

  it("keeps a pending apply when status still shows the previous outcome", () => {
    const pending = { idempotencyKey: "key", operationId: null, targetFingerprint: TARGET_FINGERPRINT };
    const previous = operation(operationId("previous"), "failed", "download_failed", "Interrupted");
    expect(intentAfterStatus(pending, { ...status("macos-universal"), activeOperation: previous })).toBe(
      pending,
    );
  });
});

describe("transient failures while the server restarts", () => {
  it("shows 503s and timeouts of an active update as waiting, then the outcome", async () => {
    vi.useFakeTimers();
    const harness = await observedHarness();
    const id = operationId("restart");
    harness.transport.apply.mockResolvedValue({ operationId: id, phase: "accepted" });
    const restarting = { ...operation(id, "installing"), progress: { stage: "restarting" } as const };
    harness.operations.set("server", restarting);
    await harness.resource.apply("server", TARGET_FINGERPRINT);
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.view("server")).toMatchObject({ phase: "installing", progress: restarting.progress });

    const failures = [
      new HostUpdateHttpError(503, "starting", "Companion is starting"),
      new HostUpdateUnreachableError("Companion did not respond in time. Try again."),
    ];
    let restartingNow = true;
    const read = harness.transport.readOperation.getMockImplementation();
    harness.transport.readOperation.mockImplementation(async (connectionId, operation) => {
      if (restartingNow) {
        const failure = failures.shift();
        failures.push(failure ?? new Error("unreachable"));
        throw failure;
      }
      return read?.(connectionId, operation) ?? Promise.reject(new Error("No operation"));
    });
    await vi.advanceTimersByTimeAsync(40);
    expect(harness.transport.readOperation.mock.calls.length).toBeGreaterThan(3);
    expect(harness.view("server")).toMatchObject({
      disconnected: true,
      errorMessage: null,
      phase: "installing",
      progress: restarting.progress,
    });

    restartingNow = false;
    harness.operations.set("server", operation(id, "committed"));
    harness.statuses.set("server", { ...status("macos-universal", null), currentVersion: "1.1.0" });
    await vi.advanceTimersByTimeAsync(200);
    expect(harness.view("server")).toMatchObject({
      currentVersion: "1.1.0",
      disconnected: false,
      errorMessage: null,
      phase: "committed",
    });
    harness.resource.forget("server");
  });

  it("keeps the last confirmed status while a background read cannot reach a restarting server", async () => {
    vi.useFakeTimers();
    const harness = await observedHarness();
    harness.transport.readStatus.mockRejectedValueOnce(
      new HostUpdateHttpError(503, "http_error", "Relay update request failed (503)"),
    );
    harness.advance(30_000);
    harness.resource.observe("server", true);
    await settle();
    expect(harness.view("server")).toMatchObject({
      currentVersion: "1.0.0",
      disconnected: true,
      errorMessage: null,
    });

    harness.statuses.set("server", { ...status("macos-universal", null), currentVersion: "1.1.0" });
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.view("server")).toMatchObject({ currentVersion: "1.1.0", disconnected: false });
    harness.resource.forget("server");
  });

  it("shows the failure once the server stays unreachable past the grace period", async () => {
    vi.useFakeTimers();
    const harness = await observedHarness();
    harness.transport.readStatus.mockRejectedValue(new HostUpdateUnreachableError("Secure tunnel failed"));
    harness.advance(30_000);
    harness.resource.observe("server", true);
    await settle();
    expect(harness.view("server").disconnected).toBe(true);

    harness.advance(60_000);
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.view("server")).toMatchObject({
      disconnected: false,
      errorCode: "transport_error",
      errorMessage: "Secure tunnel failed",
    });
    harness.resource.forget("server");
  });

  it("does not hide a definitive or first-read failure", async () => {
    const harness = createHarness();
    harness.transport.readStatus.mockRejectedValueOnce(new HostUpdateUnreachableError("No route"));
    harness.resource.observe("server", true);
    await settle();
    expect(harness.view("server")).toMatchObject({ disconnected: false, errorMessage: "No route" });
  });
});
