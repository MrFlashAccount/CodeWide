import { describe, expect, it } from "vitest";

import { commandReceiptsFromOperation, commandReceiptsFromTurn, operationConfirmsDeliveredCommand } from "../src/data/command-receipt-evidence";

describe("native command receipt evidence", () => {
  it("extracts only scoped identifiers from canonical user items", () => {
    const item = { type: "userMessage", id: "item", clientId: "command", content: ["private text"] };
    const expected = [{ threadId: "thread", commandId: "command", turnId: "turn", itemId: "item" }];
    expect(commandReceiptsFromOperation("thread", { kind: "itemUpsert", turnId: "turn", item })).toEqual(expected);
    expect(commandReceiptsFromTurn("thread", { id: "turn", items: [item] })).toEqual(expected);
    expect(commandReceiptsFromOperation("thread", { kind: "turnCompleted", turn: { id: "turn", items: [item] } })).toEqual(expected);
  });

  it("does not infer receipts from empty turns, deltas or incomplete identities", () => {
    expect(commandReceiptsFromOperation("thread", { kind: "turnStarted", turn: { id: "turn", items: [] } })).toEqual([]);
    expect(commandReceiptsFromOperation("thread", { kind: "itemTextDelta", turnId: "turn", itemId: "item", delta: "text" })).toEqual([]);
    for (const item of [null, { type: "userMessage", id: "item" },
      { type: "agentMessage", id: "item", clientId: "command" }, { type: "userMessage", id: "", clientId: "command" }]) {
      expect(commandReceiptsFromTurn("thread", { id: "turn", items: [item] })).toEqual([]);
    }
    expect(commandReceiptsFromTurn("thread", { items: [{ type: "userMessage", id: "item", clientId: "command" }] })).toEqual([]);
  });
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
