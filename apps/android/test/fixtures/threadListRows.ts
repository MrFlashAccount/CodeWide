import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import type { LiveActivity } from "@codewide/sync-client";
import type {
  ServerRowsChange,
  ThreadSummaryDatabaseOptions,
} from "../../src/data/thread-summary-database-contract";
import {
  parseThreadListRowsFrame,
  type ListStreamGeneration,
  type ThreadListRowsFrame,
} from "../../src/data/threadListRow";
import { createThreadListStream, type ThreadListStream } from "../../src/data/threadListStream";

/** List metadata a Companion row carries in `codewideList`. */
export type ListMeta = {
  readonly archived?: boolean;
  readonly cursor: number;
  readonly liveActivity?: LiveActivity | null;
};

/** A wire `thread/list` or pushed row: the thread without turns plus `codewideList`. */
export function listedThread(thread: Thread, meta: ListMeta): Thread & { codewideList: unknown } {
  return {
    ...thread,
    codewideList: {
      archived: meta.archived ?? false,
      cursor: meta.cursor,
      liveActivity: meta.liveActivity ?? null,
    },
    turns: [],
  };
}

/** A stream with a recording row sink, for database options in tests. */
export function testListStream(): {
  readonly applied: Array<{ connectionId: string; frame: unknown }>;
  readonly options: ThreadSummaryDatabaseOptions;
  readonly serverRows: Array<{ change: ServerRowsChange; connectionId: string }>;
  readonly stream: ThreadListStream;
} {
  const applied: Array<{ connectionId: string; frame: unknown }> = [];
  const serverRows: Array<{ change: ServerRowsChange; connectionId: string }> = [];
  const stream = createThreadListStream({
    applyRows: async (connectionId, _generation, frame) => {
      applied.push({ connectionId, frame });
      await Promise.resolve();
    },
  });
  return {
    applied,
    options: {
      listRace: stream.race,
      onServerRows: (connectionId, change) => {
        serverRows.push({ change, connectionId });
      },
    },
    serverRows,
    stream,
  };
}

/** A validated `threadListRows` frame built from wire rows and tombstones. */
export function rowsFrame(
  rows: readonly unknown[],
  removed: readonly { readonly cursor: number; readonly threadId: string }[] = [],
): ThreadListRowsFrame {
  const parsed = parseThreadListRowsFrame({ removed, rows, type: "threadListRows" });
  if (parsed.status === "error") {
    throw new Error(parsed.error);
  }
  return parsed.value;
}

/** The generation a stream accepted for a connection. */
export function streamGeneration(
  stream: ThreadListStream,
  connectionId = "server",
): ListStreamGeneration {
  const generation = stream.race.generation(connectionId);
  if (generation === null) {
    throw new Error("The test stream has no generation yet");
  }
  return generation;
}
