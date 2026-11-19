import { afterEach, expect, it, vi } from "vitest";
import { terminalOutputEvents } from "../src/data/terminalOutputEvents";
import type { TerminalOutputRequest } from "../src/services/content/terminalOutputRequest";

vi.mock("../src/rendering/command-output-resource", () => ({
  readCommandOutput: async () => ({ hasMore: false, text: "private chunk\n" }),
}));
const { followTerminalOutput } =
  await import("../src/features/conversation/turns/followTerminalOutput");

function request(): TerminalOutputRequest {
  return {
    command: "test",
    connectionId: "connection",
    getTransferAccess: async () => {
      throw new Error("unused");
    },
    itemId: "command",
    kind: "backgroundTerminal",
    isRunning: async () => true,
    processId: "process",
    read: async () => null,
    threadId: "thread",
  };
}
function delta(text: string, threadId = "thread") {
  terminalOutputEvents.publish("connection", "item/commandExecution/outputDelta", {
    delta: text,
    itemId: "command",
    threadId,
  });
}
function complete(text: string) {
  terminalOutputEvents.publish("connection", "item/completed", {
    item: {
      id: "command",
      type: "commandExecution",
      command: "test",
      aggregatedOutput: text,
      status: "completed",
      exitCode: 0,
    },
    threadId: "thread",
  });
}
const settled = async () => {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
};
afterEach(() => {
  vi.useRealTimers();
});

it("receives only the qualified command, then replaces the partial tail with canonical output", async () => {
  const controller = new AbortController();
  const publish = vi.fn();
  const done = followTerminalOutput({
    key: "live",
    publish,
    request: request(),
    signal: controller.signal,
  });
  delta("wrong thread\n", "another");
  delta("new line\n");
  await settled();
  expect(publish).toHaveBeenLastCalledWith(
    expect.objectContaining({
      output: { text: "new line\n", totalChars: 9, headOmitted: true },
      phase: "live",
    }),
  );
  complete("earlier line\nnew line\n");
  const result = await done;
  expect(result.phase).toBe("complete");
  expect(result.output).toStrictEqual({
    headOmitted: false,
    text: "earlier line\nnew line\n",
    totalChars: 22,
  });
  expect(result.status).toBe("finished");
});

it("keeps ordered inline and externalized deltas and reads externalized completion", async () => {
  const publish = vi.fn();
  const done = followTerminalOutput({
    key: "segments",
    publish,
    request: request(),
    signal: new AbortController().signal,
  });
  const reference = {
    byteLength: 14,
    contentType: "text/plain",
    encoding: "utf-8",
    id: "a".repeat(64),
  };
  delta("first\n");
  terminalOutputEvents.publish("connection", "item/commandExecution/outputDelta", {
    codewideContent: { version: 1, fields: { "/delta": reference } },
    delta: "preview",
    itemId: "command",
    threadId: "thread",
  });
  delta("last\n");
  await settled();
  expect(publish).toHaveBeenLastCalledWith(
    expect.objectContaining({
      output: { headOmitted: true, text: "first\nprivate chunk\nlast\n", totalChars: 25 },
    }),
  );
  terminalOutputEvents.publish("connection", "item/completed", {
    item: {
      id: "command",
      type: "commandExecution",
      command: "test",
      aggregatedOutput: "preview",
      status: "failed",
      exitCode: 1,
      codewideContent: { version: 1, fields: { "/aggregatedOutput": reference } },
    },
    threadId: "thread",
  });
  const result = await done;
  expect(result.output.text).toBe("private chunk\n");
  expect(result.status).toBe("failed");
});

it("recovers completion from history when the end event was lost", async () => {
  vi.useFakeTimers();
  const isRunning = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
  const read = vi.fn(async () => ({
    command: "test",
    exitCode: 0,
    output: "whole output",
    references: [],
    status: "completed" as const,
  }));
  const done = followTerminalOutput({
    key: "repair",
    publish: () => undefined,
    request: { ...request(), isRunning, read },
    signal: new AbortController().signal,
  });
  await settled();
  await vi.advanceTimersByTimeAsync(5000);
  expect((await done).output.text).toBe("whole output");
  expect(read).toHaveBeenCalledWith("command", expect.any(AbortSignal));
});

it("closing aborts waiting and releases the subscription without terminating the process", async () => {
  const controller = new AbortController();
  const publish = vi.fn();
  const done = followTerminalOutput({
    key: "abort",
    publish,
    request: request(),
    signal: controller.signal,
  });
  await settled();
  controller.abort();
  await expect(done).rejects.toMatchObject({ name: "AbortError" });
  const before = publish.mock.calls.length;
  delta("after close");
  complete("after close");
  expect(publish).toHaveBeenCalledTimes(before);
});

it("bounds the live tail and reports transport failure instead of inventing completion", async () => {
  const controller = new AbortController();
  const publish = vi.fn();
  const done = followTerminalOutput({
    key: "bounded",
    publish,
    request: request(),
    signal: controller.signal,
  });
  const text = "x".repeat(2_000_000);
  delta(text);
  await settled();
  const last = publish.mock.calls.at(-1)?.[0];
  expect(last.output.text.length).toBeLessThan(text.length);
  expect(last.output.totalChars).toBe(text.length);
  controller.abort();
  await expect(done).rejects.toMatchObject({ name: "AbortError" });
  const failed = followTerminalOutput({
    key: "failure",
    publish,
    request: {
      ...request(),
      isRunning: async () => {
        throw new Error("Disconnected");
      },
    },
    signal: new AbortController().signal,
  });
  await expect(failed).rejects.toThrow("Disconnected");
});

it("accepts completion arriving while a not-yet-written history read is in flight", async () => {
  const done = followTerminalOutput({
    key: "completion-race",
    publish: () => undefined,
    request: {
      ...request(),
      isRunning: async () => false,
      read: async () => {
        complete("authoritative output");
        return null;
      },
    },
    signal: new AbortController().signal,
  });
  expect((await done).output.text).toBe("authoritative output");
});

it("retries a lagging history snapshot and eventually exposes an unavailable result", async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockResolvedValueOnce(null).mockResolvedValue({
    command: "test",
    exitCode: 0,
    output: "settled",
    references: [],
    status: "completed",
  });
  const done = followTerminalOutput({
    key: "lagging",
    publish: () => undefined,
    request: { ...request(), isRunning: async () => false, read },
    signal: new AbortController().signal,
  });
  await settled();
  await vi.advanceTimersByTimeAsync(5000);
  expect((await done).output.text).toBe("settled");
  const missing = followTerminalOutput({
    key: "missing",
    publish: () => undefined,
    request: { ...request(), isRunning: async () => false },
    signal: new AbortController().signal,
  });
  const failure = expect(missing).rejects.toThrow("not available in history");
  await vi.advanceTimersByTimeAsync(15_000);
  await failure;
});
