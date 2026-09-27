import { describe, expect, it, vi } from "vitest";
import { createGlobalSupervisorRecoveryNotice } from "../src/data/globalSupervisorRecoveryNotice";

function fixture() {
  const abort = new AbortController();
  const appendText = vi.fn(async (_text: string) => undefined);
  const accepted = vi.fn();
  const failed = vi.fn();
  const isReady = vi.fn(() => true);
  const notify = createGlobalSupervisorRecoveryNotice({
    appendText,
    isReady,
    onAccepted: accepted,
    onFailure: failed,
    signal: abort.signal,
  });
  return { abort, appendText, accepted, failed, isReady, notify };
}

describe("live recovery acknowledgement", () => {
  it("does not send a stale recovery notice if media or RPC drops before dispatch", async () => {
    const input = fixture();
    const notifying = input.notify();
    input.isReady.mockReturnValue(false);
    await notifying;
    expect(input.appendText).not.toHaveBeenCalled();
    expect(input.accepted).not.toHaveBeenCalled();
    expect(input.failed).not.toHaveBeenCalled();
    input.isReady.mockReturnValue(true);
    await input.notify();
    expect(input.appendText).toHaveBeenCalledOnce();
  });
  it("coalesces concurrent notifications and asks only for a short recovery acknowledgement", async () => {
    const input = fixture();
    const pending = Promise.withResolvers<void>();
    input.appendText.mockImplementationOnce(async () => pending.promise);
    const first = input.notify();
    const duplicate = input.notify();
    await Promise.resolve();
    expect(input.appendText).toHaveBeenCalledOnce();
    expect(input.appendText.mock.calls[0]?.[0]).toContain("one short sentence");
    expect(input.appendText.mock.calls[0]?.[0]).toContain("preferred language");
    expect(input.appendText.mock.calls[0]?.[0]).toContain("repeat previous requests or actions");
    expect(input.appendText.mock.calls[0]?.[0]).toContain(
      "claim you heard speech during the outage",
    );
    pending.resolve();
    await Promise.all([first, duplicate]);
    expect(input.accepted).toHaveBeenCalledOnce();
    expect(input.failed).not.toHaveBeenCalled();
  });

  it("reports failed live delivery to recovery instead of queuing a later announcement", async () => {
    const input = fixture();
    input.appendText.mockRejectedValueOnce(new Error("connection lost"));
    await expect(input.notify()).rejects.toThrow("connection lost");
    expect(input.failed).toHaveBeenCalledOnce();
    expect(input.accepted).not.toHaveBeenCalled();
    expect(input.appendText).toHaveBeenCalledOnce();
  });

  it("Stop before dispatch cancels speech, including a same-tick recovery notification", async () => {
    const input = fixture();
    const notifying = input.notify();
    input.abort.abort();
    await expect(notifying).rejects.toThrow("cancelled");
    await expect(input.notify()).rejects.toThrow("cancelled");
    expect(input.appendText).not.toHaveBeenCalled();
    expect(input.failed).not.toHaveBeenCalled();
  });

  it("ignores a late acknowledgement after the transport has stopped", async () => {
    const input = fixture();
    const pending = Promise.withResolvers<void>();
    input.appendText.mockImplementationOnce(async () => pending.promise);
    const notifying = input.notify();
    await Promise.resolve();
    input.abort.abort();
    pending.resolve();
    await notifying;
    expect(input.accepted).not.toHaveBeenCalled();
    expect(input.failed).not.toHaveBeenCalled();
    expect(input.appendText).toHaveBeenCalledOnce();
  });
});
