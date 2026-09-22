import type { Turn } from "@codewide/codex-protocol/v0.155.1/v2";
import { describe, expect, it } from "vitest";

import { advanceThreadOutcome, latestThreadOutcome } from "../src/data/thread-current-outcome";

function turn(id: string, startedAt: number | null, status: Turn["status"]): Turn {
  return { id, startedAt, status, items: [], itemsView: "full", completedAt: null, durationMs: null,
    error: status === "failed" ? { message: "Request rejected", codexErrorInfo: null, additionalDetails: null } : null };
}

describe("current turn outcome", () => {
  it("shows only the tail failure, not the last historical failure", () => {
    expect(latestThreadOutcome([turn("failed", 1, "failed")])).toMatchObject({ status: "failed", message: "Request rejected" });
    expect(latestThreadOutcome([turn("failed", 1, "failed"), turn("next", 2, "completed")])).toMatchObject({ status: "completed" });
    expect(latestThreadOutcome([])).toBeNull();
  });

  it("tracks failure and subsequent recovery without reviving errors from older repairs", () => {
    const active = latestThreadOutcome([turn("current", 20, "inProgress")]);
    const failed = advanceThreadOutcome(active, [turn("current", 20, "failed")]);
    expect(failed).toMatchObject({ status: "failed" });
    expect(advanceThreadOutcome(failed, [turn("old", 10, "completed")])).toBe(failed);
    const next = advanceThreadOutcome(failed, [turn("next", 30, "inProgress")]);
    expect(next).toMatchObject({ turnId: "next", status: "inProgress" });
    expect(advanceThreadOutcome(next, [turn("current", 20, "failed")])).toBe(next);
    expect(advanceThreadOutcome(next, [])).toBe(next);
  });

  it("can settle the same turn without timestamps and supplies missing error details", () => {
    const active = latestThreadOutcome([turn("current", null, "inProgress")]);
    expect(advanceThreadOutcome(active, [{ ...turn("current", null, "failed"), error: null }]))
      .toMatchObject({ status: "failed", message: "The server could not complete this response." });
  });

  it.each([null, 20])("uses an ordered new-turn event instead of guessing timestamp order (%s)", (startedAt) => {
    const failed = latestThreadOutcome([turn("current", startedAt, "failed")]);
    const next = advanceThreadOutcome(failed, [turn("next", startedAt, "inProgress")], "next");
    expect(next).toMatchObject({ turnId: "next", status: "inProgress" });
    expect(advanceThreadOutcome(next, [turn("current", startedAt, "failed")])).toBe(next);
    expect(advanceThreadOutcome(failed, [turn("next", startedAt, "completed")], "next"))
      .toMatchObject({ turnId: "next", status: "completed" });
  });
});
