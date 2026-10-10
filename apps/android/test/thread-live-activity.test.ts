import type { SyncEvent } from "@codewide/sync-client";
import { describe, expect, it } from "vitest";

import type { ThreadProjectionStore } from "../src/data/thread-projection-store";
import { threadSummaryKey } from "../src/data/thread-summary-projection";
import {
  createThreadLiveActivityProjection,
  threadLiveActivity$,
} from "../src/data/threadLiveActivity";

let cursor = 0;

function event(threadId: string, operation: Record<string, unknown>): SyncEvent {
  cursor += 1;
  return {
    cursor,
    payload: {
      codewideThreadPatch: { operation: { kind: "itemUpsert", ...operation }, threadId, version: 1 },
      method: "item/started",
      params: { threadId, turnId: "turn" },
    },
  };
}

function projection(): { readonly snapshots: string[]; readonly store: ThreadProjectionStore } {
  const snapshots: string[] = [];
  return {
    snapshots,
    store: createThreadLiveActivityProjection({
      async applyEvents() {
        return { checkpoint: Promise.resolve(), threads: new Map() };
      },
      async applySnapshot(connectionId) {
        snapshots.push(connectionId);
      },
    }),
  };
}

const activity = (connectionId: string, threadId: string) =>
  threadLiveActivity$.peek()[threadSummaryKey(connectionId, threadId)];

describe("thread live activity owner", () => {
  it("publishes set changes, keeps unchanged patches and removes cleared activity", async () => {
    const { store } = projection();
    await store.applyEvents("server", [
      event("thread", { liveActivity: { command: "cargo test", kind: "command" } }),
      event("other", { liveActivity: { kind: "webSearch" } }),
    ]);
    expect(activity("server", "thread")).toEqual({ command: "cargo test", kind: "command" });

    await store.applyEvents("server", [event("thread", {})]);
    expect(activity("server", "thread")).toEqual({ command: "cargo test", kind: "command" });

    await store.applyEvents("server", [
      event("thread", { liveActivity: { kind: "compacting" } }),
      event("thread", { kind: "turnCompleted", liveActivity: null }),
    ]);
    expect(activity("server", "thread")).toBeUndefined();
    expect(activity("server", "other")).toEqual({ kind: "webSearch" });
  });

  it("starts a connection from no activity after its snapshot without touching others", async () => {
    const { snapshots, store } = projection();
    await store.applyEvents("first", [event("thread", { liveActivity: { kind: "webSearch" } })]);
    await store.applyEvents("second", [event("thread", { liveActivity: { kind: "webSearch" } })]);

    await store.applySnapshot("first", [], cursor);

    expect(snapshots).toEqual(["first"]);
    expect(activity("first", "thread")).toBeUndefined();
    expect(activity("second", "thread")).toEqual({ kind: "webSearch" });
  });
});
