import type { RpcClient } from "@codewide/sync-client";
import { LegendList } from "@legendapp/list/react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Suspense, useState } from "react";
import { Text } from "react-native";
import { sqliteFixture, catalogThread } from "./thread-catalog-pagination.fixture";
import { createCatalogRuntime } from "../src/data/catalog-runtime";
import { createThreadSummaryDatabase } from "../src/data/thread-summary-database.native";
import { useThreadListWorkspace } from "../src/features/threadList/threadListWorkspace";
import { MobileThreads } from "../src/features/threadList/MobileThreads";
import type { ThreadSummaryDatabase } from "../src/data/thread-summary-database-contract";

let mockSqlite: ReturnType<typeof sqliteFixture>;
// Only host SQL and visual chrome are substituted. Production MobileThreads,
// its native list callbacks, cursor owner, merge, SQLite and Legend model run together.
jest.mock("../src/data/ui-cache-persistence.native", () => ({
  getUiCacheSqliteDatabase: () => mockSqlite.database,
}));
jest.mock("../src/features/threadList/MobileThreadsHeader", () => ({
  MobileThreadsHeader: () => null,
}));
jest.mock("../src/features/projects/NewThreadFloatingButton", () => ({
  NewThreadFloatingButton: () => null,
}));
jest.mock("../src/features/threadList/ThreadRow", () => ({
  ThreadRow: ({ thread }: { thread: { title: string } }) => {
    const { Text: RowText } = require("react-native");
    return <RowText>{thread.title}</RowText>;
  },
}));

const noop = () => undefined;
const done = async () => undefined;
function ThreadList({
  database,
  archived = false,
  project = false,
}: {
  database: ThreadSummaryDatabase;
  archived?: boolean;
  project?: boolean;
}) {
  const [projectLimit, setProjectLimit] = useState(36);
  const [limit, setLimit] = useState(36);
  const remote = {
    accountRateLimitsDatabase: null,
    pendingRequests: [],
    threadSummaryDatabase: database,
  };
  const mode = archived ? "archived" : "active";
  const list = useThreadListWorkspace(remote, { kind: "all" }, mode, limit, setLimit);
  return (
    <MobileThreads
      archivedThreads={list.archivedThreads}
      threads={list.serverThreads}
      catalogState={{ status: "empty" }}
      filter="all"
      globalVoice={{ state: "idle", orbState: "idle", onToggle: noop }}
      initialOffset={0}
      mode={mode}
      onArchive={done}
      onFilterChange={noop}
      onLoadMore={list.loadMoreThreads}
      onLoadMoreProject={setProjectLimit}
      onManageTerminals={noop}
      onToggleRead={done}
      onModeChange={noop}
      onNewThread={noop}
      onOffsetChange={noop}
      onOpenProject={noop}
      onOpenSearch={noop}
      onBackToProjects={noop}
      onManageProjects={noop}
      onQueryChange={noop}
      onSelectServer={noop}
      threadNavigation={{
        getThreadLink: (thread) => ({
          dismissTo: false,
          href: {
            pathname: "/threads/[connectionId]/[threadId]",
            params: { connectionId: thread.serverId, threadId: thread.id },
          },
        }),
        prepareThreadLink: noop,
      }}
      onSettings={noop}
      onTogglePin={done}
      onUnarchive={done}
      project={
        project
          ? {
              connectionId: "server",
              key: "server:/repo",
              lastUsedAt: 0,
              name: "Repo",
              path: "/repo",
              pinned: true,
              serverLabel: null,
              subtitle: "/repo",
              unread: false,
            }
          : null
      }
      projectLimit={projectLimit}
      projects={[]}
      query=""
      remote={remote}
      searchContent={null}
      servers={[]}
      serverScope={{ kind: "all" }}
    />
  );
}

let dispose = () => undefined;
beforeEach(() => {
  mockSqlite = sqliteFixture();
});
afterEach(async () => {
  await act(async () => {
    dispose();
    await mockSqlite.settled();
  });
  mockSqlite.native.close();
});

async function setup(
  options: {
    count?: number;
    cached?: boolean;
    archived?: boolean;
    project?: boolean;
    connections?: number;
    gate?: (cursor: string | null) => Promise<void>;
  } = {},
) {
  const database = createThreadSummaryDatabase();
  const threads = Array.from({ length: options.count ?? 110 }, (_, index) => catalogThread(index));
  const connections = options.connections === 2 ? ["server", "second"] : ["server"];
  const rpc = jest.fn(
    async (
      _method: string,
      params: { cursor: string | null; archived: boolean },
      connectionId: string,
    ) => {
      await options.gate?.(params.cursor);
      if (params.archived !== (options.archived ?? false)) return { data: [], nextCursor: null };
      const start = params.cursor === null ? 0 : Number(params.cursor);
      return {
        data: threads
          .slice(start, start + 36)
          .map((thread) =>
            connections.length === 1
              ? thread
              : { ...thread, name: `${connectionId}: ${thread.name}` },
          ),
        nextCursor: start + 36 < threads.length ? String(start + 36) : null,
      };
    },
  );
  // WHY: RpcClient's generic result is caller-selected. The production loader validates
  // this fixture's complete DTO at the wire boundary, as it does an actual RPC reply.
  const session = (connectionId: string) =>
    ({
      rpc: (method: string, params: { cursor: string | null; archived: boolean }) =>
        rpc(method, params, connectionId),
    }) as unknown as RpcClient;
  const runtime = createCatalogRuntime({
    desiredThreadId: () => undefined,
    enabledConnectionIds: () => connections,
    getSession: session,
    getSummaries: () => database,
    readThread: async () => null,
  });
  runtime.bindSummaryDemand(database);
  await database.prepare();
  if (options.cached)
    await database.mergeSnapshots("server", [{ archived: false, thread: catalogThread(0) }]);
  const view = render(
    <Suspense fallback={<Text>Loading</Text>}>
      <ThreadList database={database} archived={options.archived} project={options.project} />
    </Suspense>,
  );
  dispose = () => {
    view.unmount();
    for (const id of connections) runtime.closeCatalogWindows(id);
    database.close();
  };
  await act(async () => {
    await mockSqlite.settled();
  });
  const list = () => view.UNSAFE_getByType(LegendList);
  return { database, list, rpc, runtime, view };
}

function deferred() {
  let resolve = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  "merges the next cursor and renders older rows during an active drag (archived=%s, project=%s)",
  async (archived, project) => {
    const test = await setup({ archived, project });
    await waitFor(() => expect(test.view.getByText("Chat 35")).toBeVisible());
    fireEvent(test.list(), "scrollBeginDrag");
    await act(async () => {
      fireEvent(test.list(), "endReached");
    });
    await waitFor(() =>
      expect(test.rpc).toHaveBeenCalledWith(
        "thread/list",
        expect.objectContaining({ cursor: "36", archived, ...(project ? { cwd: "/repo" } : {}) }),
        "server",
      ),
    );
    await waitFor(async () =>
      expect(await test.database.get("server", "thread-71")).not.toBeNull(),
    );
    await waitFor(() => expect(test.view.getByText("Chat 71")).toBeVisible());
  },
);

it("retains an end intent received while the cached first page is still refreshing", async () => {
  const head = deferred();
  const test = await setup({
    cached: true,
    gate: (cursor) => (cursor === null ? head.promise : Promise.resolve()),
  });
  await waitFor(() => expect(test.view.getByText("Chat 0")).toBeVisible());
  await act(async () => {
    fireEvent(test.list(), "endReached");
  });
  await act(async () => head.resolve());
  await waitFor(() => expect(test.view.getByText("Chat 71")).toBeVisible());
});

it("fills an undersized viewport without requiring a second end callback, and stops at exhaustion", async () => {
  const test = await setup({ count: 80 });
  await waitFor(() => expect(test.view.getByText("Chat 35")).toBeVisible());
  fireEvent(test.list(), "layout", { nativeEvent: { layout: { height: 10000 } } });
  fireEvent(test.list(), "contentSizeChange", 400, 2880);
  // No onEndReached: native measurements alone express an unfilled viewport.
  await waitFor(() => expect(test.view.getByText("Chat 79")).toBeVisible());
  fireEvent(test.list(), "contentSizeChange", 400, 6400);
  await act(async () => {
    await new Promise((done) => setTimeout(done, 40));
  });
  expect(test.rpc.mock.calls.map((call) => call[1].cursor)).toEqual([null, "36", "72"]);
});

it("publishes a requested tail before a concurrent background refresh can restart the head", async () => {
  const tail = deferred();
  const refreshedHead = deferred();
  let heads = 0;
  const test = await setup({
    gate: (cursor) => {
      if (cursor === "36") return tail.promise;
      if (cursor === null && ++heads > 1) return refreshedHead.promise;
      return Promise.resolve();
    },
  });
  await waitFor(() => expect(test.view.getByText("Chat 35")).toBeVisible());
  await act(async () => {
    fireEvent(test.list(), "endReached");
  });
  await waitFor(() =>
    expect(test.rpc).toHaveBeenCalledWith(
      "thread/list",
      expect.objectContaining({ cursor: "36" }),
      "server",
    ),
  );
  act(() => test.runtime.refreshConnectionWindows("server"));
  await act(async () => tail.resolve());
  await waitFor(() => expect(test.view.getByText("Chat 71")).toBeVisible());
  await act(async () => refreshedHead.resolve());
});

it("reveals the remaining merged local range when every server cursor is already exhausted", async () => {
  const test = await setup({ count: 25, connections: 2 });
  await waitFor(async () => expect(await test.database.get("second", "thread-24")).not.toBeNull());
  await waitFor(() => expect(test.view.getAllByText(/Chat /)).toHaveLength(36));
  expect(
    await test.database.ensureCatalog({
      archivedLimit: 0,
      connectionId: null,
      recentLimit: 36,
      selectedConnectionId: null,
      selectedThreadId: null,
      subagentConnectionId: null,
      subagentLimit: 0,
    }),
  ).toBe(true);
  await act(async () => {
    fireEvent(test.list(), "endReached");
    await mockSqlite.settled();
  });
  await waitFor(() => expect(test.view.getAllByText(/Chat /)).toHaveLength(50));
  expect(test.rpc).toHaveBeenCalledTimes(2);
});
