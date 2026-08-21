import { describe, expect, it } from "vitest";

import { operationConfirmsDeliveredCommand } from "../src/data/command-receipt-evidence";

describe("native command receipt evidence", () => {
  it("does not scan receipts for streaming deltas", () => {
    expect(operationConfirmsDeliveredCommand({
      kind: "itemTextDelta",
      turnId: "turn",
      itemId: "agent",
      itemType: "agentMessage",
      delta: "hello",
    })).toBe(false);
  });

  it("recognizes a user item with a stable client id", () => {
    expect(operationConfirmsDeliveredCommand({
      kind: "itemUpsert",
      turnId: "turn",
      item: { type: "userMessage", id: "user", clientId: "command", content: [] },
    })).toBe(true);
  });

  it("ignores user items without the delivery identity", () => {
    expect(operationConfirmsDeliveredCommand({
      kind: "turnStarted",
      turn: { id: "turn", items: [{ type: "userMessage", id: "user", content: [] }] },
    })).toBe(false);
  });
});
