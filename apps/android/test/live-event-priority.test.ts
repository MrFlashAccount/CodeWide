import { describe, expect, it } from "vitest";

import { shouldFlushLiveEventsImmediately } from "../src/data/live-event-priority";

const event = (method: string) => ({ cursor: 1, payload: { method, params: {} } });

describe("live event render priority", () => {
  it("batches ordinary deltas", () => {
    expect(shouldFlushLiveEventsImmediately([
      event("item/agentMessage/delta"),
      event("item/commandExecution/outputDelta"),
    ])).toBe(false);
  });

  it.each([
    "turn/started",
    "turn/completed",
    "item/completed",
    "item/commandExecution/requestApproval",
    "mcpServer/elicitation/request",
    "thread/realtime/error",
    "companion/thread/progress",
    "companion/thread/invalidated",
  ])("flushes %s without the normal render delay", (method) => {
    expect(shouldFlushLiveEventsImmediately([event(method)])).toBe(true);
  });
});
