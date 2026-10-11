import { describe, expect, it } from "vitest";

import {
  reportedSubagentStates,
  rootsWithChangedSubagentActivity,
  withActiveSubagents,
} from "../src/data/threadSummarySubagentActivity";
import { storedThreadToListItem } from "../src/features/threadList/threadListProjection";
import { summary } from "./fixtures/thread-summary";

const active = { activeFlags: [], type: "active" } as const;

describe("sub-agent activity on the root row", () => {
  it("marks a root whose nested sub-agent runs and clears it when none does", () => {
    const root = summary("root");
    const child = summary("child", { parentThreadId: "root" });
    const grandchild = summary("grandchild", { parentThreadId: "child", status: active });
    expect(withActiveSubagents(root, [root, child, grandchild]).activeSubagents).toBe(true);
    const marked = { ...root, activeSubagents: true };
    const stopped = { ...grandchild, status: { type: "idle" } as const };
    expect(rootsWithChangedSubagentActivity([stopped], [marked, child, stopped])).toEqual([
      { ...marked, activeSubagents: false },
    ]);
    // An unchanged flag writes nothing.
    expect(rootsWithChangedSubagentActivity([stopped], [root, child, stopped])).toEqual([]);
  });

  it("shows an idle root as running while its sub-agents run", () => {
    expect(storedThreadToListItem(summary("root", { activeSubagents: true })).state).toBe("running");
    expect(storedThreadToListItem(summary("root")).state).toBeUndefined();
  });

  it("reads sub-agent states from a parent's collab item", () => {
    const event = (status: string) => ({
      method: "item/completed",
      params: {
        item: {
          agentsStates: { "root:agent:a": { message: null, status }, "root:agent:b": { status: "notFound" } },
          type: "collabAgentToolCall",
        },
        threadId: "root",
      },
    });
    expect(reportedSubagentStates(event("running"))).toEqual([{ active: true, threadId: "root:agent:a" }]);
    expect(reportedSubagentStates(event("completed"))).toEqual([{ active: false, threadId: "root:agent:a" }]);
    expect(reportedSubagentStates({ method: "item/completed", params: { item: { type: "commandExecution" } } })).toEqual([]);
  });
});
