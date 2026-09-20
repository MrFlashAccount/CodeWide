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
  const rpc = jest.fn(async () => ({ data: [], nextCursor: null }));
  // WHY: RpcClient has a caller-selected generic result. This fixture supplies
  // the validated thread/list wire shape consumed by the real catalog adapter.
  const session = { rpc } as unknown as RpcClient;
  let requests: readonly ThreadSummaryViewRequest[] = [archivedRequest];
  let loadCatalog: ((request: ThreadSummaryViewRequest) => Promise<void>) | undefined;
  const release = jest.fn();
  // WHY: The catalog runtime consumes this established database port, while
  // this behavior test intentionally supplies only the catalog-facing methods.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const summaries = {
    applyCatalogPage: jest.fn(async () => undefined),
    beginCatalogRead: () => ({ changed: new Set<string>(), release }),
    model: { activeRequests: () => requests },
    setCatalogLoader(loader: (request: ThreadSummaryViewRequest) => Promise<void>) {
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
