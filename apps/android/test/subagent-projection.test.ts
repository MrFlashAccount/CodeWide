import { describe, expect, it } from "vitest";

import {
  subagentActivityTargetThreadId,
  SubagentListProjection,
  subagentDisplayName,
  subagentsForThread,
} from "../src/data/subagent-projection";
import { threadSummaryDescendantKeys, threadSummaryKey } from "../src/data/thread-summary-projection";
import type { StoredThreadSummary } from "../src/data/thread-summary-types";

function summary(
  id: string,
  parentThreadId: string | null,
  recencyAt: number,
  overrides: Partial<StoredThreadSummary> = {},
): StoredThreadSummary {
  return {
    connectionId: "server",
    remoteThreadId: id,
    parentThreadId,
    agentNickname: null,
    agentRole: null,
    name: null,
    preview: "",
    cwd: "/workspace",
    updatedAt: recencyAt,
    recencyAt,
    status: { type: "idle" },
    pinned: false,
    archived: false,
    pendingRequestCount: 0,
    latestActivityCursor: 0,
    lastSeenCursor: 0,
    unread: 0,
    deleteCommandId: null,
    ...overrides,
  };
}

describe("subagent projection", () => {
  it("keeps subagents out of the root projection and sorts them by recency", () => {
    const projection = new SubagentListProjection();
    const values = [summary("root", null, 4), summary("old", "root", 1), summary("new", "root", 3)];

    expect(projection.project(values).map((row) => row.remoteThreadId)).toEqual(["new", "old"]);
    expect(projection.project(values)).toBe(projection.project(values));
  });

  it("does not freeze an initially empty projection when a live-query array mutates in place", () => {
    const projection = new SubagentListProjection();
    const values = [summary("root", null, 1)];

    expect(projection.project(values)).toEqual([]);
    values.push(summary("spawned", "root", 2));

    expect(projection.project(values).map((row) => row.remoteThreadId)).toEqual(["spawned"]);
  });

  it("includes nested descendants without leaking a sibling tree", () => {
    const values = [
      summary("direct", "root", 2),
      summary("nested", "direct", 4),
      summary("sibling", "other-root", 9),
    ];

    expect(subagentsForThread(values, "root").map((row) => row.remoteThreadId)).toEqual(["nested", "direct"]);
  });

  it("walks a reverse-ordered deep tree once and terminates cycles without including the root", () => {
    let parentReads = 0;
    const descendants = Array.from({ length: 128 }, (_, index) => {
      const parent = index === 0 ? "root" : `child-${index - 1}`;
      return { ...summary(`child-${index}`, parent, index),
        get parentThreadId() { parentReads += 1; return parent; },
      };
    }).reverse();
    const rows = [...descendants, summary("root", "child-127", -1), summary("orphan", "missing", 500)];
    parentReads = 0;
    expect(subagentsForThread(rows, "root").map((row) => row.remoteThreadId)).toEqual(descendants.map((row) => row.remoteThreadId));
    // The performance contract is one parent read per input row, independent
    // of tree depth; the two uninstrumented rows do not contribute reads.
    expect(parentReads).toBe(descendants.length);
    parentReads = 0;
    expect(threadSummaryDescendantKeys(rows, "root")).toEqual(new Set(descendants.map((row) => threadSummaryKey("server", row.remoteThreadId))));
    expect(parentReads).toBe(descendants.length);
  });

  it("uses the app-server nickname as the visible title", () => {
    const value = summary("agent", "root", 1, { agentNickname: "frontend_taste", name: "Fallback", agentRole: "frontend" });
    expect(subagentDisplayName(value)).toBe("frontend_taste");
  });

  it("resolves a concrete subagent navigation target without guessing among several receivers", () => {
    expect(subagentActivityTargetThreadId({
      type: "subAgentActivity",
      id: "activity",
      kind: "started",
      agentThreadId: "child",
      agentPath: "/root/child",
    })).toBe("child");
    expect(subagentActivityTargetThreadId({
      type: "collabAgentToolCall",
      id: "spawn",
      tool: "spawnAgent",
      status: "completed",
      senderThreadId: "root",
      receiverThreadIds: ["child"],
      prompt: null,
      model: null,
      reasoningEffort: null,
      agentsStates: {},
    })).toBe("child");
    expect(subagentActivityTargetThreadId({
      type: "collabAgentToolCall",
      id: "wait",
      tool: "wait",
      status: "completed",
      senderThreadId: "root",
      receiverThreadIds: ["first", "second"],
      prompt: null,
      model: null,
      reasoningEffort: null,
      agentsStates: {},
    })).toBeNull();
  });
});
