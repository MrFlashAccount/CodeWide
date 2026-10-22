import type { RpcClient } from "@codewide/sync-client";
import { waitFor } from "@testing-library/react-native";

import { createCatalogRuntime } from "../src/data/catalog-runtime";
import type { ThreadSummaryDatabase } from "../src/data/thread-summary-database-contract";
import type { ThreadSummaryViewRequest } from "../src/data/thread-summary-model";

const archivedRequest: ThreadSummaryViewRequest = {
  archivedLimit: 36,
  connectionId: "server",
  recentLimit: 0,
  selectedConnectionId: null,
  selectedThreadId: null,
  subagentConnectionId: null,
  subagentLimit: 0,
};

it("refreshes the archive only while an archive view requests it", async () => {
  const rpc = jest.fn(async (_method: string, _params: unknown) => ({ data: [], nextCursor: null }));
  // WHY: RpcClient has a caller-selected generic result. This fixture supplies
  // the validated thread/list wire shape consumed by the real catalog adapter.
  const session = { rpc: (method: string, params: unknown) => method === "companion/thread/pins/list" ? Promise.resolve({ archivedThreadIds: [], cursor: 0, threadIds: [] }) : rpc(method, params) } as unknown as RpcClient;
  let requests: readonly ThreadSummaryViewRequest[] = [archivedRequest];
  let loadCatalog: ((request: ThreadSummaryViewRequest) => Promise<boolean>) | undefined;
  const release = jest.fn();
  // WHY: The catalog runtime consumes this established database port, while
  // this behavior test intentionally supplies only the catalog-facing methods.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const summaries = {
    loadPendingPinMigration: jest.fn(async () => []),
    applyPinSnapshot: jest.fn(async () => undefined),
    mergeSnapshots: jest.fn(async () => undefined),
    removeCatalogEntries: jest.fn(async () => undefined),
    applyCatalogPage: jest.fn(async () => undefined),
    beginCatalogRead: () => ({ changed: new Set<string>(), release }),
    model: { activeRequests: () => requests },
    setCatalogLoader(loader: (request: ThreadSummaryViewRequest) => Promise<boolean>) {
      loadCatalog = loader;
    },
  } as ThreadSummaryDatabase;
  const runtime = createCatalogRuntime({
    desiredThreadId: () => undefined,
    enabledConnectionIds: () => ["server"],
    getSession: () => session,
    getSummaries: () => summaries,
    listGeneration: () => null,
    readThread: async () => null,
    setListStreamVisible: async () => undefined,
  });
  runtime.bindSummaryDemand(summaries);
  if (loadCatalog === undefined) {
    throw new Error("Catalog loader was not bound");
  }

  await loadCatalog(archivedRequest);
  const archiveReads = () =>
    rpc.mock.calls.filter(([, params]) => (params as { archived?: boolean }).archived === true).length;
  expect(archiveReads()).toBe(1);

  await runtime.refreshThreadCatalog("server");
  expect(archiveReads()).toBe(2);

  requests = [{ ...archivedRequest, archivedLimit: 0, recentLimit: 36 }];
  await runtime.refreshThreadCatalog("server");
  expect(archiveReads()).toBe(2);
  expect(release).toHaveBeenCalledTimes(rpc.mock.calls.length);
});

it("reads a root's subagents on every request and shares a concurrent read", async () => {
  const indexed: { threads: Array<Record<string, unknown>> } = { threads: [] };
  const reads = jest.fn(async () => indexed);
  // WHY: RpcClient has a caller-selected generic result; this fixture answers only the
  // descendant-index read with its validated wire shape.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const session = { rpc: async (method: string) => (method === "companion/threadSubagents/read" ? reads() : { data: [], nextCursor: null }) } as unknown as RpcClient;
  const replaced: string[][] = [];
  // WHY: The catalog runtime consumes this established database port, while this behavior
  // test supplies only the subagent-catalog method it exercises.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const summaries = {
    replaceSubagentCatalog: jest.fn(async (_connectionId: string, _root: string, threads: Array<{ thread: { id: string; status: { type: string } } }>) => {
      replaced.push(threads.map(({ thread }) => `${thread.id}:${thread.status.type}`));
    }),
  } as unknown as ThreadSummaryDatabase;
  const runtime = createCatalogRuntime({
    desiredThreadId: () => undefined,
    enabledConnectionIds: () => ["server"],
    getSession: () => session,
    getSummaries: () => summaries,
    listGeneration: () => null,
    readThread: async () => null,
    setListStreamVisible: async () => undefined,
  });
  const row = {
    agentNickname: null, agentRole: "Explore", archived: false, cliVersion: "claude", createdAt: 1,
    cwd: "/repo", id: "root:agent:a1", modelProvider: "anthropic", parentThreadId: "root",
    source: "appServer", updatedAt: 2,
  };

  indexed.threads = [{ ...row, running: true }];
  await Promise.all([runtime.refreshSubagents("server", "root"), runtime.refreshSubagents("server", "root")]);
  expect(reads).toHaveBeenCalledTimes(1);
  // A finished agent must reach the catalog at once, not after a freshness window.
  indexed.threads = [{ ...row, running: false }];
  await runtime.refreshSubagents("server", "root");
  expect(reads).toHaveBeenCalledTimes(2);
  expect(replaced).toEqual([["root:agent:a1:active"], ["root:agent:a1:idle"]]);
});

it("re-reads on every request without a freshness window, with one trailing run behind a running one, also after a failure", async () => {
  jest.useFakeTimers();
  const replies: Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void }> = [];
  const listCalls = jest.fn();
  // WHY: RpcClient has a caller-selected generic result. This fixture answers pin reads
  // with their validated wire shape and holds each thread/list reply until the test settles it.
  const session = {
    rpc: (method: string) => {
      if (method === "companion/thread/pins/list") {
        return Promise.resolve({ archivedThreadIds: [], cursor: 0, threadIds: [] });
      }
      listCalls();
      return new Promise((resolve, reject) => {
        replies.push({ reject, resolve });
      });
    },
  } as unknown as RpcClient;
  // WHY: The catalog runtime consumes this established database port, while
  // this behavior test intentionally supplies only the catalog-facing methods.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const summaries = {
    loadPendingPinMigration: jest.fn(async () => []),
    applyPinSnapshot: jest.fn(async () => undefined),
    mergeSnapshots: jest.fn(async () => undefined),
    removeCatalogEntries: jest.fn(async () => undefined),
    applyCatalogPage: jest.fn(async () => undefined),
    beginCatalogRead: () => ({ changed: new Set<string>(), release: jest.fn() }),
    model: { activeRequests: () => [] },
    setCatalogLoader: () => undefined,
  } as unknown as ThreadSummaryDatabase;
  const runtime = createCatalogRuntime({
    desiredThreadId: () => undefined,
    enabledConnectionIds: () => ["server"],
    getSession: () => session,
    getSummaries: () => summaries,
    listGeneration: () => null,
    readThread: async () => null,
    setListStreamVisible: async () => undefined,
  });

  try {
    const first = runtime.refreshThreadCatalog("server");
    const rejected = expect(first).rejects.toThrow("thread/list failed");
    await waitFor(() => {
      expect(listCalls).toHaveBeenCalledTimes(1);
    });
    const trailing = Array.from({ length: 5 }, () => runtime.refreshThreadCatalog("server"));
    replies[0]?.reject(new Error("thread/list failed"));
    await jest.advanceTimersByTimeAsync(250);
    expect(listCalls).toHaveBeenCalledTimes(2);
    replies[1]?.reject(new Error("thread/list failed"));
    await jest.advanceTimersByTimeAsync(500);
    expect(listCalls).toHaveBeenCalledTimes(3);
    replies[2]?.reject(new Error("thread/list failed"));
    await jest.advanceTimersByTimeAsync(1000);
    expect(listCalls).toHaveBeenCalledTimes(4);
    replies[3]?.reject(new Error("thread/list failed"));
    await rejected;
    await waitFor(() => {
      expect(listCalls).toHaveBeenCalledTimes(5);
    });
    replies[4]?.resolve({ data: [], nextCursor: null });
    await Promise.all(trailing);
    expect(listCalls).toHaveBeenCalledTimes(5);

    // A settled connection re-reads again at once: there is no freshness window.
    const next = runtime.refreshThreadCatalog("server");
    await waitFor(() => {
      expect(listCalls).toHaveBeenCalledTimes(6);
    });
    replies[5]?.resolve({ data: [], nextCursor: null });
    await next;
  } finally {
    jest.useRealTimers();
  }
});
