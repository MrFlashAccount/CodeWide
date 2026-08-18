import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { HostQueueStore } from "../src/host-queue.js";

describe("host durable queue", () => {
  it("persists, edits, reorders and reconciles uncertain commands privately", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-queue-"));
    const filePath = path.join(directory, "queue.json");
    const store = await HostQueueStore.open(filePath);
    await store.put(command("command-1", "thread-1", "first", 1));
    await store.put(command("command-2", "thread-1", "second", 2));
    await store.editText("command-2", "edited second");
    expect(await store.move("command-2", -1)).toBe(true);
    await store.markUncertain("command-2");
    await store.close();

    expect((await stat(filePath)).mode & 0o077).toBe(0);
    const reopened = await HostQueueStore.open(filePath);
    expect(reopened.list("thread-1").map((entry) => ({ id: entry.commandId, state: entry.state }))).toEqual([
      { id: "command-2", state: "uncertain" },
      { id: "command-1", state: "queued" },
    ]);
    expect(reopened.readyHeads().map((entry) => entry.commandId)).toEqual(["command-2"]);
    await reopened.markDelivered("command-2");
    await expect(reopened.put(command("command-2", "thread-1", "edited second", 2)))
      .resolves.toMatchObject({ state: "delivered" });
    expect(reopened.readyHeads().map((entry) => entry.commandId)).toEqual(["command-1"]);
    expect(await reopened.cancel("command-1")).toBe(true);
    expect(reopened.list()).toMatchObject([{ commandId: "command-2", state: "delivered" }]);
    await reopened.close();

    const afterRestart = await HostQueueStore.open(filePath);
    await expect(afterRestart.put(command("command-2", "thread-1", "edited second", 2)))
      .resolves.toMatchObject({ state: "delivered" });
    expect(afterRestart.readyHeads()).toEqual([]);
    await afterRestart.close();
  });

  it("makes identical puts idempotent and rejects conflicting payload reuse", async () => {
    const store = await HostQueueStore.open();
    const input = command("command-1", "thread-1", "first", 1);
    await store.put(input);
    await expect(store.put(input)).resolves.toMatchObject({ commandId: "command-1" });
    await expect(store.put(command("command-1", "thread-1", "different", 1))).rejects.toThrow("different payload");
  });

  it("keeps the durable command unchanged when an edit exceeds the serialized cap", async () => {
    const store = await HostQueueStore.open();
    const padded = command("command-1", "thread-1", "original", 1);
    (padded.params.input as Array<Record<string, unknown>>).push({ type: "mention", name: "x".repeat(60_000), path: "/workspace/context" });
    await store.put(padded);
    await expect(store.editText("command-1", "x".repeat(1_000_000))).rejects.toThrow("too large");
    expect((store.list()[0]?.params.input as Array<{ text?: string }> | undefined)?.[0]?.text).toBe("original");
  });

  it("allows an explicitly rejected command to be removed but retains uncertain delivery", async () => {
    const store = await HostQueueStore.open();
    await store.put(command("failed", "thread-1", "bad", 1));
    await store.markFailed("failed", "invalid params");
    expect(await store.cancel("failed")).toBe(true);
    await store.put(command("uncertain", "thread-1", "maybe delivered", 2));
    await store.markUncertain("uncertain");
    expect(await store.cancel("uncertain")).toBe(false);
    expect(store.list()).toMatchObject([{ commandId: "uncertain", state: "uncertain" }]);
  });

  it("uses absolute idempotent placement for durable mobile reordering", async () => {
    const store = await HostQueueStore.open();
    await store.put(command("first", "thread-1", "first", 1));
    await store.put(command("second", "thread-1", "second", 2));
    await store.put(command("third", "thread-1", "third", 3));

    expect(await store.place("third", "first")).toBe(true);
    expect(store.list("thread-1").map((entry) => entry.commandId)).toEqual(["third", "first", "second"]);
    // Retrying after a lost RPC response must not apply the movement twice.
    expect(await store.place("third", "first")).toBe(false);
    expect(store.list("thread-1").map((entry) => entry.commandId)).toEqual(["third", "first", "second"]);
  });
});

function command(commandId: string, remoteThreadId: string, text: string, createdAt: number) {
  return {
    commandId,
    remoteThreadId,
    method: "turn/start",
    params: {
      threadId: remoteThreadId,
      clientUserMessageId: commandId,
      input: [{ type: "text", text, text_elements: [] }],
    },
    createdAt,
  };
}
