import { describe, expect, it } from "vitest";

import { hasAcceptedPendingDelivery, parseHostQueueSnapshot } from "../src/data/queue-event";

describe("companion queue events", () => {
  it("accepts an authoritative delivered receipt", () => {
    expect(parseHostQueueSnapshot([{
      commandId: "queued-1",
      remoteThreadId: "thread-1",
      params: { threadId: "thread-1", input: [{ type: "text", text: "next" }] },
      state: "delivered",
      order: 1,
      createdAt: 10,
      lastError: null,
    }])).toMatchObject([{ commandId: "queued-1", state: "delivered" }]);
  });

  it("keeps transport delivery separate from the explicit user queue", () => {
    expect(parseHostQueueSnapshot([{
      commandId: "direct-1",
      remoteThreadId: "thread-1",
      params: { threadId: "thread-1", input: [{ type: "text", text: "direct" }] },
      presentation: "delivery",
      workspaceRequestId: "workspace-1",
      state: "queued",
      order: 1,
      createdAt: 10,
      lastError: null,
    }])).toMatchObject([{
      commandId: "direct-1",
      presentation: "delivery",
      workspaceRequestId: "workspace-1",
    }]);
  });

  it("rejects a malformed snapshot instead of poisoning the local projection", () => {
    expect(parseHostQueueSnapshot([{ commandId: "queued-1", state: "delivered" }])).toBeNull();
    expect(parseHostQueueSnapshot({ data: [] })).toBeNull();
  });

  it("reconciles only an accepted delivery that still has a local receipt", () => {
    const commands = parseHostQueueSnapshot([
      {
        commandId: "historical",
        remoteThreadId: "thread-1",
        params: { threadId: "thread-1", input: [{ type: "text", text: "old" }] },
        presentation: "delivery",
        state: "delivered",
        order: 1,
        createdAt: 10,
        lastError: null,
      },
      {
        commandId: "current",
        remoteThreadId: "thread-1",
        params: { threadId: "thread-1", input: [{ type: "text", text: "new" }] },
        presentation: "delivery",
        state: "delivered",
        order: 2,
        createdAt: 20,
        lastError: null,
      },
    ]);
    expect(commands).not.toBeNull();
    expect(hasAcceptedPendingDelivery(commands!, (commandId) => commandId === "current")).toBe(true);
    expect(hasAcceptedPendingDelivery(commands!, () => false)).toBe(false);
  });
});
