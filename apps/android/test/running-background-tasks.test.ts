import { RpcResponseError } from "@codewide/sync-client";
import { describe, expect, it, vi } from "vitest";

import { backgroundTaskInvalidationBus } from "../src/data/backgroundTaskInvalidationBus";
import { listRunningBackgroundTasks } from "../src/data/runningBackgroundTasks";

const running = {
  background: {
    description: "Run the tests",
    startedAt: 1_760_000_100,
    status: "running",
    taskId: "b1",
  },
  command: "npm test",
  itemId: "toolu_bg",
  kind: "task",
  turnId: "turn-1",
};
const terminal = { command: "pnpm dev", itemId: "call_exec", kind: "terminal", processId: "1042" };

describe("running background tasks", () => {
  it("reads the thread's running tasks and terminals, each with the item that launched it", async () => {
    const call = vi.fn(async () => ({
      tasks: [running, terminal, { command: "broken" }, { ...terminal, processId: null }],
    }));
    const tasks = await listRunningBackgroundTasks(call, "thread-1");
    expect(call).toHaveBeenCalledWith("companion/thread/backgroundTasks/list", {
      threadId: "thread-1",
    });
    expect(tasks).toEqual([
      {
        command: "npm test",
        itemId: "toolu_bg",
        kind: "task",
        task: expect.objectContaining({
          description: "Run the tests",
          status: "running",
          taskId: "b1",
        }),
        turnId: "turn-1",
      },
      terminal,
    ]);
  });

  it.each([
    new RpcResponseError(-32_601, "Method not found"),
    new RpcResponseError(-32_072, "Capability unsupported"),
  ])("shows nothing for a host or provider that cannot list them %#", async (error) => {
    await expect(
      listRunningBackgroundTasks(async () => Promise.reject(error), "t"),
    ).resolves.toEqual([]);
  });

  it("surfaces any other failure", async () => {
    const failure = new RpcResponseError(-32_600, "thread not found: t");
    await expect(listRunningBackgroundTasks(async () => Promise.reject(failure), "t")).rejects.toBe(
      failure,
    );
  });

  it("names the thread of an event that launches, ends or reports a background command", () => {
    const changed = vi.fn();
    const unsubscribe = backgroundTaskInvalidationBus.subscribe(changed);
    backgroundTaskInvalidationBus.publish("server", {
      item: {
        codewideBackgroundTask: running.background,
        id: "toolu_bg",
        type: "commandExecution",
      },
      threadId: "launching",
    });
    backgroundTaskInvalidationBus.publish("server", {
      threadId: "completing",
      turn: { items: [{ id: "n1", taskId: "b1", type: "codewideTaskNotification" }] },
    });
    backgroundTaskInvalidationBus.publish("server", {
      item: { command: "pnpm dev", id: "call_exec", processId: "1042", type: "commandExecution" },
      threadId: "terminal",
    });
    backgroundTaskInvalidationBus.publish("server", {
      item: { command: "ls", id: "call_ls", processId: null, type: "commandExecution" },
      threadId: "foreground",
    });
    backgroundTaskInvalidationBus.publish("server", {
      item: { id: "m1", text: "hi", type: "agentMessage" },
      threadId: "chatting",
    });
    backgroundTaskInvalidationBus.publish("server", null);
    unsubscribe();
    backgroundTaskInvalidationBus.publish("server", {
      item: { codewideBackgroundTask: running.background },
      threadId: "after",
    });
    expect(changed.mock.calls).toEqual([
      ["server", "launching"],
      ["server", "completing"],
      ["server", "terminal"],
    ]);
  });
});
