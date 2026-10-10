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
    readThread: async () => null,
  });
  runtime.bindSummaryDemand(summaries);
  if (loadCatalog === undefined) {
    throw new Error("Catalog loader was not bound");
  }

  await loadCatalog(archivedRequest);
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenLastCalledWith("thread/list", expect.objectContaining({ archived: true }));

  runtime.refreshConnectionWindows("server");
  await waitFor(() => {
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  requests = [{ ...archivedRequest, archivedLimit: 0, recentLimit: 36 }];
  runtime.refreshConnectionWindows("server");
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(release).toHaveBeenCalledTimes(2);
});

it("keeps reading a spawning thread's subagents until the index lists the new agent", async () => {
  jest.useFakeTimers();
  try {
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
      replaceSubagentCatalog: jest.fn(async (_connectionId: string, _root: string, threads: Array<{ thread: { id: string } }>) => {
        replaced.push(threads.map(({ thread }) => thread.id));
      }),
    } as unknown as ThreadSummaryDatabase;
    const runtime = createCatalogRuntime({
      desiredThreadId: () => undefined,
      enabledConnectionIds: () => ["server"],
      getSession: () => session,
      getSummaries: () => summaries,
      readThread: async () => null,
    });

    runtime.refreshSpawnedSubagents("server", "root");
    await jest.advanceTimersByTimeAsync(0);
    expect(replaced.at(-1)).toEqual([]);
    indexed.threads = [{
      agentNickname: null, agentRole: "Explore", archived: false, cliVersion: "claude", createdAt: 1,
      cwd: "/repo", id: "root:agent:a1", modelProvider: "anthropic", parentThreadId: "root",
      source: "appServer", updatedAt: 2,
    }];
    await jest.advanceTimersByTimeAsync(10_000);
    expect(replaced.at(-1)).toEqual(["root:agent:a1"]);
    expect(reads.mock.calls.length).toBeGreaterThan(1);
  } finally {
    jest.useRealTimers();
  }
});
