import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { describe, expect, it } from "vitest";

import {
  isThreadLifecycleActive,
  pendingDeliveryMayOwnTurn,
  staleTurnLifecycleId,
} from "../src/data/thread-lifecycle";

describe("thread lifecycle presentation", () => {
  it("treats running and approval summaries as live", () => {
    expect(isThreadLifecycleActive("running")).toBe(true);
    expect(isThreadLifecycleActive("approval")).toBe(true);
    expect(isThreadLifecycleActive(undefined)).toBe(false);
  });

  it("queues behind a direct delivery before live lifecycle catches up", () => {
    expect(pendingDeliveryMayOwnTurn("queued")).toBe(true);
    expect(pendingDeliveryMayOwnTurn("sending")).toBe(true);
    expect(pendingDeliveryMayOwnTurn("companionAccepted")).toBe(true);
    expect(pendingDeliveryMayOwnTurn("appServerAccepted")).toBe(true);
    expect(pendingDeliveryMayOwnTurn("uncertain")).toBe(true);
    expect(pendingDeliveryMayOwnTurn("failed")).toBe(false);
  });

  it("detects a stale live head without inventing terminal TURN state", () => {
    const value = thread("idle", "inProgress");

    expect(staleTurnLifecycleId(value)).toBe("turn");
    expect(value.turns[0]?.status).toBe("inProgress");
  });

  it("does not guess while the thread lifecycle is active or unknown", () => {
    const active = thread("active", "inProgress");
    const unknown = thread("notLoaded", "inProgress");

    expect(staleTurnLifecycleId(active)).toBeNull();
    expect(staleTurnLifecycleId(unknown)).toBeNull();
  });

  it("selects the newest stale head for canonical repair", () => {
    const value = thread("idle", "inProgress");
    value.turns.push({ ...value.turns[0]!, id: "newer-turn" });

    expect(staleTurnLifecycleId(value)).toBe("newer-turn");
    expect(value.turns.map(({ status }) => status)).toEqual(["inProgress", "inProgress"]);
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
