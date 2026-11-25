import { expect, it, vi } from "vitest";
import { readTerminalCommand } from "../src/data/readTerminalCommand";

const item = {
  id: "command",
  type: "commandExecution",
  command: "watch",
  status: "completed",
  aggregatedOutput: "all output",
  exitCode: 0,
};
const signal = new AbortController().signal;

it("finds a completed command outside the visible history window without reading another thread", async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce({
      data: [{ id: "recent", status: "completed", items: [] }],
      nextCursor: "older",
    })
    .mockResolvedValueOnce({
      data: [{ id: "origin", status: "completed", items: [item] }],
      nextCursor: null,
    });
  expect(
    await readTerminalCommand(call, { itemId: "command", signal, threadId: "thread" }),
  ).toEqual({
    command: "watch",
    exitCode: 0,
    output: "all output",
    references: [],
    status: "completed",
  });
  expect(call).toHaveBeenNthCalledWith(
    2,
    "thread/turns/list",
    expect.objectContaining({ cursor: "older", itemsView: "full", threadId: "thread" }),
  );
});

it("does not mistake an incomplete item or missing output for a completed history result", async () => {
  for (const items of [[], [{ ...item, status: "inProgress" }]]) {
    const call = vi.fn(async () => ({
      data: [{ id: "turn", status: "completed", items }],
      nextCursor: null,
    }));
    expect(
      await readTerminalCommand(call, { itemId: "command", signal, threadId: "thread" }),
    ).toBeNull();
  }
});

it("stops a cyclic cursor and cancellation instead of walking history indefinitely", async () => {
  const call = vi
    .fn()
    .mockResolvedValueOnce({ data: [], nextCursor: "a" })
    .mockResolvedValueOnce({ data: [], nextCursor: "b" })
    .mockResolvedValue({ data: [], nextCursor: "a" });
  await expect(
    readTerminalCommand(call, { itemId: "command", signal, threadId: "thread" }),
  ).rejects.toThrow("repeated history cursor");
  const controller = new AbortController();
  controller.abort();
  const abortedCall = vi.fn();
  await expect(
    readTerminalCommand(abortedCall, {
      itemId: "command",
      signal: controller.signal,
      threadId: "thread",
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(abortedCall).not.toHaveBeenCalled();
});
