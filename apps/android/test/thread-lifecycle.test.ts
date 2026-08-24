import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { describe, expect, it } from "vitest";

import {
  isThreadLifecycleActive,
  reconcileThreadLifecyclePresentation,
  staleTurnLifecycleId,
} from "../src/data/thread-lifecycle";

describe("thread lifecycle presentation", () => {
  it("treats running and approval summaries as live", () => {
    expect(isThreadLifecycleActive("running")).toBe(true);
    expect(isThreadLifecycleActive("approval")).toBe(true);
    expect(isThreadLifecycleActive(undefined)).toBe(false);
  });

  it("atomically closes a stale live head when the thread is already idle", () => {
    const value = thread("idle", "inProgress");

    expect(staleTurnLifecycleId(value)).toBe("turn");
    const projected = reconcileThreadLifecyclePresentation(value);

    expect(projected.turns[0]?.status).toBe("completed");
    expect(value.turns[0]?.status).toBe("inProgress");
  });

  it("does not guess while the thread lifecycle is active or unknown", () => {
    const active = thread("active", "inProgress");
    const unknown = thread("notLoaded", "inProgress");

    expect(staleTurnLifecycleId(active)).toBeNull();
    expect(staleTurnLifecycleId(unknown)).toBeNull();
    expect(reconcileThreadLifecyclePresentation(active)).toBe(active);
    expect(reconcileThreadLifecyclePresentation(unknown)).toBe(unknown);
  });

  it("projects a system-error head as failed", () => {
    expect(reconcileThreadLifecyclePresentation(thread("systemError", "inProgress")).turns[0]?.status).toBe("failed");
  });

  it("leaves no stale live partition behind on a terminal thread", () => {
    const value = thread("idle", "inProgress");
    value.turns.push({ ...value.turns[0]!, id: "newer-turn" });

    expect(reconcileThreadLifecyclePresentation(value).turns.map(({ status }) => status)).toEqual(["completed", "completed"]);
    expect(staleTurnLifecycleId(value)).toBe("newer-turn");
  });
});

function thread(
  status: "active" | "idle" | "notLoaded" | "systemError",
  turnStatus: "inProgress" | "completed",
): Thread {
  return {
    id: "thread",
    status: status === "active" ? { type: "active", activeFlags: [] } : { type: status },
    turns: [{ id: "turn", status: turnStatus, items: [] }],
  } as unknown as Thread;
}
