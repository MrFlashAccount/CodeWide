import { describe, expect, it } from "vitest";
import { activityRange, parseActivityMetrics, projectedActivityMetrics, projectedItemActivityRange } from "../src/activity-metrics";
import { applyThreadEvent } from "../src/thread-events";
import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";

const footprint = {version: 1, basis: "approxBytesPerToken", bytes: 4, estimatedTokens: 137, estimatedInputCostUsd: 0.125};
const summary = {count: 58, kinds: ["commandExecution"], outputFootprint: footprint};
const metrics = {version: 1, total: summary, ranges: [{firstItemId:"a",lastItemId:"z",summary}], commands:{z:footprint}};

describe("server activity figures", () => {
  it("validates and selects an exact range without recomputing figures", () => {
    const parsed = parseActivityMetrics(metrics);
    expect(parsed?.total).toEqual(summary);
    expect(activityRange(parsed,"a","z")).toEqual(summary);
    expect(activityRange(parsed,"a","unknown")).toBeNull();
    expect(projectedItemActivityRange({id:"a",codewideActivityRanges:metrics.ranges},"z")).toEqual(summary);
  });
  it("rejects missing, malformed and nonfinite figures", () => {
    for (const value of [null, {}, {...metrics,version:2}, {...metrics,total:{...summary,count:-1}}, {...metrics,total:{...summary,outputFootprint:{...footprint,estimatedInputCostUsd:Infinity}}}]) {
      expect(parseActivityMetrics(value)).toBeNull();
    }
    expect(projectedActivityMetrics({items:[{aggregatedOutput:"do not count me"}]})).toBeNull();
  });
  it("replays authoritative live patches and preserves figures at completion", () => {
    const thread: Thread = {
      id: "thread", environments: null, extra: null, sessionId: "thread", forkedFromId: null,
      parentThreadId: null, preview: "", ephemeral: false, section: null, sectionEnteredAt: null,
      projectId: null, historyMode: "paginated", modelProvider: "openai", model: null,
      reasoningEffort: null, createdAt: 0, updatedAt: 0, recencyAt: 0,
      status: { type: "active", activeFlags: [] }, path: null, cwd: "/workspace",
      cliVersion: "0.155.1", originator: null, source: "appServer", canAcceptDirectInput: true,
      threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null,
      daybreakEnabled: null,
      turns: [{ id: "turn", status: "inProgress", items: [], itemsView: "full", error: null,
        startedAt: 0, completedAt: null, durationMs: null }],
    };
    const event = {method:"item/completed",params:{threadId:"thread",turnId:"turn",item:{id:"z",type:"commandExecution",aggregatedOutput:"x"}},codewideThreadPatch:{version:1,threadId:"thread",operation:{kind:"itemUpsert",activityMetrics:metrics}}};
    expect(applyThreadEvent(thread,event)).toBe(true);
    expect(projectedActivityMetrics(thread.turns[0]!)?.total).toEqual(summary);
    applyThreadEvent(thread,{params:{threadId:"thread",turnId:"turn",itemId:"z",delta:"",codewideOutputFootprint:footprint},codewideThreadPatch:{version:1,threadId:"thread",operation:{kind:"itemTextDelta",itemType:"commandExecution",activityMetrics:{...metrics,commands:{}}}}});
    expect(thread.turns[0]?.items[0]).toMatchObject({codewideOutputFootprint:footprint});
    const next = {...metrics,total:{...summary,count:59}};
    applyThreadEvent(thread,{params:{turn:{id:"turn",status:"completed",items:[],itemsView:"full"}},codewideThreadPatch:{version:1,threadId:"thread",operation:{kind:"turnCompleted",activityMetrics:next}}});
    expect(projectedActivityMetrics(thread.turns[0]!)?.total.count).toBe(59);
    applyThreadEvent(thread,{params:{turnId:"turn"},codewideThreadPatch:{version:1,threadId:"thread",operation:{kind:"tokenUsage",activityMetrics:null}}});
    expect(projectedActivityMetrics(thread.turns[0]!)).toBeNull();
  });
});
