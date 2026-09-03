import type {
  V2BackgroundProcess,
  V2CommandTerminalFrame,
  V2Query,
  V2QueryResult,
} from "@codewide/sync-client/v2";
import { describe, expect, it, vi } from "vitest";

import { BackgroundProcessesResource } from "../src/v2/application/resources/backgroundProcessesResource";
import { savedServerId, threadId } from "../src/v2/domain/ids";
import { qualifiedThread } from "../src/v2/domain/qualifiedThread";

const PROCESS_COUNT = 205;
const PROCESS_CPU_PERCENT = 9.5;

describe("V2 background processes resource", () => {
  it("follows opaque cursors beyond the first one hundred processes", async () => {
    const owner = qualifiedThread(savedServerId("server-a"), threadId("thread-a"));
    const processes = Array.from({ length: PROCESS_COUNT }, (_, index): V2BackgroundProcess => ({
      command: `command-${String(index)}`,
      cpuPercent: null,
      cwd: "/workspace",
      itemId: `item-${String(index)}`,
      osPid: null,
      processId: `process-${String(index)}`,
      rssKiB: null,
    }));
    const executeQuery = vi.fn(async (_server: string, query: V2Query): Promise<V2QueryResult> => {
      await Promise.resolve();
      if (query.kind !== "thread.processes") {
        throw new Error("Unexpected query");
      }
      const start = query.cursor === null ? 0 : Number(query.cursor.slice("cursor-".length));
      const page = processes.slice(start, start + query.limit);
      const next = start + page.length;
      return {
        kind: "thread.processes",
        nextCursor: next < processes.length ? `cursor-${String(next)}` : null,
        processes: page,
        threadId: owner.threadId,
      };
    });
    const resource = new BackgroundProcessesResource({
      commands: {
        execute: () => {
          throw new Error("Unexpected command");
        },
      },
      owner,
      queries: { execute: executeQuery },
    });

    await vi.waitFor(() => {
      expect(resource.snapshot().value).toHaveLength(PROCESS_COUNT);
    });

    expect(
      executeQuery.mock.calls.map((call) => {
        const query = call[1];
        return query.kind === "thread.processes" ? query.cursor : undefined;
      }),
    ).toStrictEqual([null, "cursor-100", "cursor-200"]);
    expect(resource.snapshot().value.at(-1)?.processId).toBe("process-204");
    resource.stop();
  });

  it("reads actual process metrics and refreshes after authoritative termination", async () => {
    const owner = qualifiedThread(savedServerId("server-a"), threadId("thread-a"));
    let processes: V2BackgroundProcess[] = [
      {
        command: "pnpm test",
        cpuPercent: PROCESS_CPU_PERCENT,
        cwd: "/workspace",
        itemId: "item-a",
        osPid: "42",
        processId: "process-a",
        rssKiB: "2048",
      },
    ];
    const executeQuery = vi.fn(async (): Promise<V2QueryResult> => {
      await Promise.resolve();
      return {
        kind: "thread.processes",
        nextCursor: null,
        processes,
        threadId: owner.threadId,
      };
    });
    const executeCommand = vi.fn(async (): Promise<V2CommandTerminalFrame> => {
      await Promise.resolve();
      return {
        operationId: "operation-a",
        result: { kind: "process.terminate", processId: "process-a", state: "terminated" },
        type: "commandCompleted",
      };
    });
    const resource = new BackgroundProcessesResource({
      commands: { execute: executeCommand },
      owner,
      queries: { execute: executeQuery },
    });

    await vi.waitFor(() => {
      expect(resource.snapshot().value).toHaveLength(1);
    });
    processes = [];
    await resource.terminate("process-a");

    expect(executeCommand).toHaveBeenCalledWith("server-a", {
      kind: "process.terminate",
      processId: "process-a",
      threadId: "thread-a",
    });
    expect(resource.snapshot()).toStrictEqual({ status: "ready", value: [] });
    resource.stop();
  });
});
