import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { RpcClient } from "@codewide/sync-client";
import { describe, expect, it, vi } from "vitest";
import { loadThreadCatalogPage } from "../src/data/thread-catalog-loader";

export function catalogThread(id: string): Thread {
  return {
    id, parentThreadId: null, name: id, preview: "", cwd: "/repo", updatedAt: 1,
    status: { type: "idle" }, ephemeral: false, turns: [], extra: null, sessionId: id,
    forkedFromId: null, section: null, sectionEnteredAt: null, historyMode: "default",
    modelProvider: "openai", createdAt: 1, recencyAt: 1, path: null, cliVersion: "test",
    source: "cli", canAcceptDirectInput: null, threadSource: null, agentNickname: null,
    agentRole: null, gitInfo: null,
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
  it("requests each project's own active or archived continuation from Companion", async () => {
    for (const archived of [false, true]) {
      const test = client({ data: [catalogThread("project-thread")], nextCursor: "project-next" });
      const page = await loadThreadCatalogPage(test.session, { projectCwd: "/repo", archived, cursor: "project-cursor" });
      expect(test.rpc).toHaveBeenCalledExactlyOnceWith("thread/list", expect.objectContaining({ cwd: "/repo", archived, cursor: "project-cursor" }));
      expect(page.nextCursor).toBe("project-next");
    }
  });
  it("reads the Companion's full archive count from an active page without fetching the archive", async () => {
    const test = client({ data: [catalogThread("active")], nextCursor: "more", codewideCatalogSummary: { archivedCount: 80 } });
    const page = await loadThreadCatalogPage(test.session, { archived: false, cursor: null });
    expect(page.archivedCount).toBe(80);
    expect(page.threads).toHaveLength(1);
    expect(test.rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps older Companion pages usable without inventing a zero count", async () => {
    const test = client({ data: [], nextCursor: null });
    expect((await loadThreadCatalogPage(test.session, { archived: false, cursor: null })).archivedCount).toBeNull();
  });
  it("returns one page and its continuation, without loading the archive or the next page", async () => {
    const root = catalogThread("root");
    const child = { ...catalogThread("child"), parentThreadId: "root" };
    const temporary = { ...catalogThread("temporary"), ephemeral: true };
    const test = client({ data: [root, child, temporary], nextCursor: "next" });
    const page = await loadThreadCatalogPage(test.session, { archived: false, cursor: null });
    expect(page.threads).toEqual([{ thread: root, archived: false }]);
    expect(page.nextCursor).toBe("next");
    expect(test.rpc).toHaveBeenCalledExactlyOnceWith("thread/list", expect.objectContaining({
      archived: false, cursor: null, limit: 36, useStateDbOnly: true,
    }));
  });

  it("loads an explicitly requested archived continuation", async () => {
    const test = client({ data: [catalogThread("old")], nextCursor: null });
    const page = await loadThreadCatalogPage(test.session, { archived: true, cursor: "older" });
    expect(page.threads[0]?.archived).toBe(true);
    expect(test.rpc).toHaveBeenCalledExactlyOnceWith("thread/list", expect.objectContaining({
      archived: true, cursor: "older", limit: 36,
    }));
  });

  it.each([null, {}, { data: [], nextCursor: 42 }, { data: [null], nextCursor: null }])(
    "rejects malformed wire metadata", async (response) => {
      await expect(loadThreadCatalogPage(client(response).session, { archived: false, cursor: null }))
        .rejects.toThrow(/invalid/);
    },
  );

  it("rejects repeated continuation", async () => {
    await expect(loadThreadCatalogPage(client({ data: [], nextCursor: "same" }).session,
      { archived: false, cursor: "same" })).rejects.toThrow("repeated catalog cursor");
  });
});
