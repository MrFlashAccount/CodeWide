import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  persisted: [] as Array<{ type: string; key?: string; value?: { id: string } }>,
}));

// WHY: OP-SQLite needs a native JSI runtime. The fake records committed durable
// writes so the test can prove that releasing residency keeps SQLite rows.
vi.mock("../src/data/thread-detail-sqlite.native", () => ({
  createThreadDetailSqlite: (onCommit: (changes: readonly unknown[]) => void) => {
    let transaction: Array<{ type: string; key?: string; value?: { id: string } }> | null = null;
    return {
      begin: () => {
        transaction = [];
      },
      close: async () => undefined,
      commit: async () => {
        const changes = transaction ?? [];
        transaction = null;
        harness.persisted.push(...changes);
        onCommit(changes);
      },
      confirmCommandReceipts: async () => [],
      diagnostics: async () => ({
        historyBytesEvicted: 0,
        historyFamiliesEvicted: 0,
        historyPayloadBytes: 0,
        mainFileBytes: 0,
        payloadBytes: 0,
        pendingDeliveryRows: 0,
        pendingRows: 0,
        physicalBytes: 0,
        reusableBytes: 0,
        rowCount: 0,
        shmFileBytes: 0,
        staleDeliveryRowsRemoved: 0,
        walFileBytes: 0,
      }),
      flush: async () => undefined,
      loadAdjacentWindow: vi.fn(),
      loadAuthoritativeFacts: async () => [],
      loadBoundary: vi.fn(),
      loadPrependFacts: async () => [],
      loadResolvedWindow: vi.fn(),
      prepare: async () => undefined,
      rollback: () => {
        transaction = null;
      },
      write: (change: { type: string; key?: string; value?: { id: string } }) => {
        transaction?.push(change);
      },
    };
  },
}));
vi.mock("../src/data/ui-cache-persistence.native", () => ({
  getUiCacheSqliteDatabase: () => ({}),
  registerUiCacheCollectionFlusher: () => () => undefined,
}));

import { createThreadDetailDatabase } from "../src/data/thread-detail-database.native";

function thread(): Thread {
  // WHY: Only the fields read by the detail projection are relevant here.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return {
    cwd: "/repo",
    ephemeral: false,
    id: "thread",
    name: "Thread",
    preview: "hello",
    status: { type: "idle" },
    turns: [
      {
        completedAt: 2,
        id: "remote-turn",
        items: [
          { clientId: "command", content: [], id: "user", type: "userMessage" },
          { id: "agent", phase: "final_answer", text: "done", type: "agentMessage" },
        ],
        startedAt: 1,
        status: "completed",
      },
    ],
    updatedAt: 2,
  } as unknown as Thread;
}

async function repair(details: ReturnType<typeof createThreadDetailDatabase>): Promise<void> {
  await details.synchronizeThread({
    connectionId: "server",
    expectedLiveRevision: details.liveRevision("server", "thread"),
    historyCursor: null,
    mode: "merge",
    thread: thread(),
    throughCursor: 1,
  });
}

function persistedThreadRows(): number {
  return harness.persisted.filter(
    (change) => change.type !== "delete" && change.value?.id.includes("thread") === true,
  ).length;
}

beforeEach(() => {
  harness.persisted.length = 0;
});

describe("thread residency bound", () => {
  it("persists a repair of a thread without a window but keeps it non-resident", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();

    await repair(details);

    expect(details.getThread("server", "thread")).toBeNull();
    expect(persistedThreadRows()).toBeGreaterThan(0);
    await details.close();
  });

  it("keeps a mounted thread resident and drops residency when its window settles release", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    const release = details.chat.retainWindow("server", "thread");

    await repair(details);
    expect(details.getThread("server", "thread")?.turns.map((turn) => turn.id)).toEqual([
      "remote-turn",
    ]);

    release();
    await vi.waitFor(() => {
      expect(details.getThread("server", "thread")).toBeNull();
    });
    expect(persistedThreadRows()).toBeGreaterThan(0);

    details.chat.retainWindow("server", "thread");
    await repair(details);
    expect(details.getThread("server", "thread")).not.toBeNull();
    await details.close();
  });

  it("publishes interest changes to the remote loader, including a late loader", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    const release = details.chat.retainWindow("server", "thread");
    const ensureInterest = vi.fn();
    const releaseInterest = vi.fn();
    details.setRemoteLoader({
      ensureInterest,
      hydrateWindow: async () => undefined,
      loadNewer: async () => ({ status: "superseded" }),
      loadOlder: async () => undefined,
      reconcilePending: async () => undefined,
      releaseInterest,
      repairProjection: async () => undefined,
    });

    expect(ensureInterest).toHaveBeenCalledExactlyOnceWith({
      connectionId: "server",
      threadId: "thread",
    });
    release();
    await vi.waitFor(() => {
      expect(releaseInterest).toHaveBeenCalledExactlyOnceWith({
        connectionId: "server",
        threadId: "thread",
      });
    });
    await details.close();
  });
});
