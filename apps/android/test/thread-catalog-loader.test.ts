import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import type { RpcClient } from "@codewide/sync-client";
import { describe, expect, it, vi } from "vitest";
import { loadThreadCatalogPage } from "../src/data/thread-catalog-loader";
import { listedThread } from "./fixtures/threadListRows";

export function catalogThread(id: string, archived = false): Thread {
  return listedThread(threadMetadata(id), { archived, cursor: 1 });
}

function threadMetadata(id: string): Thread {
  return {
    environments: null,
    projectId: null,
    model: null,
    reasoningEffort: null,
    originator: null,
    daybreakEnabled: null,
    id,
    parentThreadId: null,
    name: id,
    preview: "",
    cwd: "/repo",
    updatedAt: 1,
    status: { type: "idle" },
    ephemeral: false,
    turns: [],
    extra: null,
    sessionId: id,
    forkedFromId: null,
    section: null,
    sectionEnteredAt: null,
    historyMode: "default",
    modelProvider: "openai",
    createdAt: 1,
    recencyAt: 1,
    path: null,
    cliVersion: "test",
    source: "cli",
    canAcceptDirectInput: null,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
  };
}

function client(response: unknown) {
  const rpc = vi.fn(async () => response);
  // WHY: RpcClient has a caller-selected generic result. This fixture supplies
  // wire data (including malformed values) for the real adapter to validate.
  const session = { rpc } as unknown as RpcClient;
  return { rpc, session };
}

describe("bounded thread catalog page", () => {
  it("retries a rejected idempotent read three times with exponential backoff", async () => {
    vi.useFakeTimers();
    try {
      const response = { data: [catalogThread("recovered")], nextCursor: null };
      const rpc = vi
        .fn()
        .mockRejectedValueOnce(new Error("first disconnect"))
        .mockRejectedValueOnce(new Error("second disconnect"))
        .mockRejectedValueOnce(new Error("third disconnect"))
        .mockResolvedValue(response);
      // WHY: RpcClient has a caller-selected generic result. This fixture exercises
      // the idempotent transport retry before the normal wire adapter validates it.
      const session = { rpc } as unknown as RpcClient;
      const loaded = loadThreadCatalogPage(session, { archived: false, cursor: null });

      await vi.advanceTimersByTimeAsync(250 + 500 + 1000);

      await expect(loaded).resolves.toMatchObject({ nextCursor: null });
      expect(rpc).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces the final read error after the three retries are exhausted", async () => {
    vi.useFakeTimers();
    try {
      const rpc = vi.fn().mockRejectedValue(new Error("Companion unavailable"));
      // WHY: RpcClient has a caller-selected generic result. This fixture exercises
      // the idempotent transport retry before the normal wire adapter validates it.
      const session = { rpc } as unknown as RpcClient;
      const loaded = loadThreadCatalogPage(session, { archived: false, cursor: null });
      const rejected = expect(loaded).rejects.toThrow("Companion unavailable");

      await vi.advanceTimersByTimeAsync(250 + 500 + 1000);

      await rejected;
      expect(rpc).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("requests each project's own active or archived continuation from Companion", async () => {
    for (const archived of [false, true]) {
      const test = client({ data: [catalogThread("project-thread")], nextCursor: "project-next" });
      const page = await loadThreadCatalogPage(test.session, {
        projectCwd: "/repo",
        archived,
        cursor: "project-cursor",
      });
      expect(test.rpc).toHaveBeenCalledExactlyOnceWith(
        "thread/list",
        expect.objectContaining({ cwd: "/repo", archived, cursor: "project-cursor" }),
      );
      expect(page.nextCursor).toBe("project-next");
    }
  });
  it("reads the Companion's full archive count from an active page without fetching the archive", async () => {
    const test = client({
      data: [catalogThread("active")],
      nextCursor: "more",
      codewideCatalogSummary: { archivedCount: 80 },
    });
    const page = await loadThreadCatalogPage(test.session, { archived: false, cursor: null });
    expect(page.archivedCount).toBe(80);
    expect(page.threads).toHaveLength(1);
    expect(test.rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps older Companion pages usable without inventing a zero count", async () => {
    const test = client({ data: [], nextCursor: null });
    expect(
      (await loadThreadCatalogPage(test.session, { archived: false, cursor: null })).archivedCount,
    ).toBeNull();
  });
  it("preserves every server-admitted row and its continuation without local visibility decisions", async () => {
    const root = catalogThread("root");
    const child = { ...catalogThread("child"), parentThreadId: "root" };
    const temporary = { ...catalogThread("temporary"), ephemeral: true };
    const test = client({ data: [root, child, temporary], nextCursor: "next" });
    const page = await loadThreadCatalogPage(test.session, { archived: false, cursor: null });
    expect(page.threads).toEqual(
      [root, child, temporary].map((thread) => ({ thread, archived: false })),
    );
    expect(page.nextCursor).toBe("next");
    expect(test.rpc).toHaveBeenCalledExactlyOnceWith(
      "thread/list",
      expect.objectContaining({
        archived: false,
        cursor: null,
        limit: 36,
        sortKey: "recency_at",
        useStateDbOnly: true,
      }),
    );
  });

  it("loads an explicitly requested archived continuation", async () => {
    const test = client({ data: [catalogThread("old", true)], nextCursor: null });
    const page = await loadThreadCatalogPage(test.session, { archived: true, cursor: "older" });
    expect(page.threads[0]?.archived).toBe(true);
    expect(page.rows[0]?.meta).toEqual({ archived: true, cursor: 1, liveActivity: null });
    expect(test.rpc).toHaveBeenCalledExactlyOnceWith(
      "thread/list",
      expect.objectContaining({
        archived: true,
        cursor: "older",
        limit: 36,
      }),
    );
  });

  it("takes each row's archive state and list cursor from codewideList, not the request", async () => {
    const unarchived = listedThread(threadMetadata("restored"), { archived: false, cursor: 42 });
    const test = client({ data: [unarchived], nextCursor: null });
    const page = await loadThreadCatalogPage(test.session, { archived: true, cursor: null });
    expect(page.threads).toEqual([{ archived: false, thread: unarchived }]);
    expect(page.rows.map((row) => [row.threadId, row.meta.cursor])).toEqual([["restored", 42]]);
  });

  it.each([
    { codewideList: undefined },
    { codewideList: { archived: false, cursor: -1, liveActivity: null } },
    { codewideList: { archived: "no", cursor: 1, liveActivity: null } },
    { codewideList: { archived: false, cursor: 1 } },
  ])("rejects a row without valid list metadata", async (meta) => {
    const row = { ...threadMetadata("row"), ...meta };
    await expect(
      loadThreadCatalogPage(client({ data: [row], nextCursor: null }).session, {
        archived: false,
        cursor: null,
      }),
    ).rejects.toThrow("invalid list metadata");
  });

  it.each([null, {}, { data: [], nextCursor: 42 }, { data: [null], nextCursor: null }])(
    "rejects malformed wire metadata",
    async (response) => {
      await expect(
        loadThreadCatalogPage(client(response).session, { archived: false, cursor: null }),
      ).rejects.toThrow(/invalid/);
    },
  );

  it("rejects repeated continuation", async () => {
    await expect(
      loadThreadCatalogPage(client({ data: [], nextCursor: "same" }).session, {
        archived: false,
        cursor: "same",
      }),
    ).rejects.toThrow("repeated catalog cursor");
  });
});
