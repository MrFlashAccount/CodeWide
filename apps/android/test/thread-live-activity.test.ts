import type { LiveActivity } from "@codewide/sync-client";
import { describe, expect, it } from "vitest";

import { threadSummaryKey } from "../src/data/thread-summary-projection";
import { applyServerRowLiveActivity, threadLiveActivity$ } from "../src/data/threadLiveActivity";
import { parseThreadListRow, type ThreadListRow } from "../src/data/threadListRow";
import { listedThread } from "./fixtures/threadListRows";
import { createV1TestThread } from "./fixtures/v1Thread";

function row(threadId: string, liveActivity: LiveActivity | null, cursor = 1): ThreadListRow {
  const parsed = parseThreadListRow(
    listedThread(createV1TestThread(threadId, null, 1, []), { cursor, liveActivity }),
  );
  if (parsed.status === "error") {
    throw new Error(parsed.error);
  }
  return parsed.value;
}

const activity = (connectionId: string, threadId: string) =>
  threadLiveActivity$.peek()[threadSummaryKey(connectionId, threadId)];

describe("thread live activity owner", () => {
  it("takes each admitted row's activity, clears a null one and removes deleted rows", () => {
    applyServerRowLiveActivity("server", {
      kind: "merge",
      removedThreadIds: [],
      rows: [
        row("thread", { command: "cargo test", kind: "command" }),
        row("other", { kind: "webSearch" }),
        row("gone", { kind: "compacting" }),
      ],
    });
    expect(activity("server", "thread")).toEqual({ command: "cargo test", kind: "command" });

    applyServerRowLiveActivity("server", {
      kind: "merge",
      removedThreadIds: ["gone"],
      rows: [row("thread", null, 2)],
    });

    expect(activity("server", "thread")).toBeUndefined();
    expect(activity("server", "gone")).toBeUndefined();
    expect(activity("server", "other")).toEqual({ kind: "webSearch" });
  });

  it("keeps the published value when an equal activity arrives again", () => {
    applyServerRowLiveActivity("server", {
      kind: "merge",
      removedThreadIds: [],
      rows: [row("steady", { kind: "planStep", step: "Write tests" })],
    });
    const published = activity("server", "steady");

    applyServerRowLiveActivity("server", {
      kind: "merge",
      removedThreadIds: [],
      rows: [row("steady", { kind: "planStep", step: "Write tests" }, 2)],
    });

    expect(activity("server", "steady")).toBe(published);
  });

  it("replaces one connection's activity from a snapshot, retaining newer pushes only", () => {
    for (const connectionId of ["first", "second"]) {
      applyServerRowLiveActivity(connectionId, {
        kind: "merge",
        removedThreadIds: [],
        rows: [row("stale", { kind: "webSearch" }), row("pushed", { kind: "compacting" })],
      });
    }

    applyServerRowLiveActivity("first", {
      kind: "replace",
      retainedThreadIds: new Set(["pushed"]),
      rows: [row("listed", { kind: "webSearch" })],
    });

    expect(activity("first", "stale")).toBeUndefined();
    expect(activity("first", "pushed")).toEqual({ kind: "compacting" });
    expect(activity("first", "listed")).toEqual({ kind: "webSearch" });
    expect(activity("second", "stale")).toEqual({ kind: "webSearch" });
  });
});
