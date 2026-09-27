import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { act, cleanup, render, waitFor } from "@testing-library/react-native";
import { NativeModules, Text, View } from "react-native";
import type { Turn } from "@codewide/codex-protocol/v0.155.1/v2";

const mockNative = NativeModules.CodeWideNative;
let mockSqlite: DatabaseSync;
let mockTransaction = Promise.resolve();

// WHY: Only Android's bridge and JSI SQLite are replaced. The actual protocol
// adapter, ordered projection, SQL, shared models and React consumer run below.
jest.mock("react-native", () => {
  const runtime = jest.requireActual("react-native");
  runtime.NativeModules.CodeWideNative = {
      attachSocket: jest.fn(async () => undefined), acknowledgeProjection: jest.fn(),
      readCommittedFrames: jest.fn(), engineRpc: jest.fn(),
      engineListCommands: jest.fn(async () => JSON.stringify({ ok: true, result: [] })),
      addListener: jest.fn(), removeListeners: jest.fn(),
  };
  return runtime;
});
jest.mock("@op-engineering/op-sqlite", () => {
  const execute = async (sql: string, params: SQLInputValue[] = []) => ({
    rows: mockSqlite.prepare(sql).all(...params),
  });
  return {
    open: () => ({
      execute,
      executeSync: (sql: string) => ({ rows: mockSqlite.prepare(sql).all() }),
      transaction: async (operation: (executor: { execute: typeof execute }) => Promise<void>) => {
        const pending = mockTransaction.then(async () => {
          mockSqlite.exec("BEGIN IMMEDIATE");
          try {
            await operation({ execute });
            mockSqlite.exec("COMMIT");
          } catch (error) {
            mockSqlite.exec("ROLLBACK");
            throw error;
          }
        });
        mockTransaction = pending.catch(() => undefined);
        await pending;
      },
    }),
  };
});
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "/cache/",
  getInfoAsync: async () => ({ exists: false }),
}));

import { NativeEngineSession } from "../src/native/native-engine.native";
import { createConnectionStateModel } from "../src/data/connection-state-model";
import { createThreadDetailDatabase } from "../src/data/thread-detail-database.native";
import { createThreadSyncRuntime } from "../src/data/thread-sync-runtime";
import { createThreadSyncRemoteLoader } from "../src/data/thread-sync-remote-loader";
import { createThreadSyncReconnect } from "../src/data/thread-sync-reconnect";
import { useThreadChatWindow } from "../src/data/use-thread-chat-window";
import { projectThreadChatWindow } from "../src/data/thread-chat-projection";
import { createV1TestThread } from "./fixtures/v1Thread";

const request = { connectionId: "server", threadId: "thread", anchorTurnId: null };
const answer: Turn = {
  id: "turn", status: "inProgress", startedAt: 1, completedAt: null, durationMs: null,
  itemsView: "full", error: null,
  items: [{ type: "agentMessage", id: "answer", text: "Recovered", phase: null,
    delivery: null, questions: null, memoryCitation: null }],
};

function wireSnapshot(throughCursor: number) {
  return { readModelVersion: 3, throughCursor,
    thread: createV1TestThread("thread", null, 1, []), activeTurn: answer,
    history: { kind: "reset", turns: [], headTurnId: null, hasMore: false, olderCursor: null } };
}

function Conversation({ details }: { details: ReturnType<typeof createThreadDetailDatabase> }) {
  const window = useThreadChatWindow(details, request, false);
  const projection = window === null ? null : projectThreadChatWindow(details, window, "server", "thread", false);
  return <View>{projection?.timeline.flatMap((entry) => entry.kind === "turn"
    ? entry.turn.items.flatMap((item) => item.type === "agentMessage"
      ? [<Text key={item.id}>{item.text}</Text>] : []) : [])}</View>;
}

async function setup(resident: boolean) {
  const details = createThreadDetailDatabase();
  await details.prepare();
  await details.importThreadSnapshot("server", createV1TestThread("thread", null, 1, resident ? [answer] : []), "initial", null);
  await details.windowResource(request).ready$.peek();
  const model = createConnectionStateModel();
  model.reconcileProfiles([{ connectionId: "server", id: "server", enabled: true }]);
  const session = new NativeEngineSession({
    connection: { id: "server", endpoint: "https://example.test", token: "test", enabled: true },
    connectionState: { setConnectionPath: model.setPath, setConnectionState: model.setState },
    projection: details,
  });
  const sync = createThreadSyncRuntime({
    clearInvalidationArchived() {}, getDetails: () => details, getSession: () => session,
    getSummaries: () => null, loadTurnControls: async () => { throw new Error("Not needed"); },
    readInvalidationArchived: () => undefined, refreshSubagents: async () => undefined,
    refreshThreadCatalog: async () => undefined,
    rpcAfterAttach: (rpc, method, params) => rpc.rpc(method, params),
    transferAccess: async () => { throw new Error("Not needed"); },
  });
  details.setRemoteLoader(createThreadSyncRemoteLoader(details, sync));
  await sync.observeThread("server", "thread");
  const reads = jest.spyOn(sync, "readThread");
  const reconnect = createThreadSyncReconnect({
    catalog: { refreshThreadCatalog: async () => undefined }, details,
    readConnection: () => model.rows$.peek()[0],
    refreshAccountRateLimits: async () => undefined, sync,
  });
  const subscription = model.subscribeChanges(reconnect.accept);
  const state = (rpcAvailable: boolean, epoch: number, status = "unvalidated", projectionState = rpcAvailable ? "live" : "connecting") => session.receive({
    contractVersion: 2, connectionId: "server", type: "state",
    data: JSON.stringify({ state: projectionState, rpcAvailable,
      path: { network: { epoch, status }, companion: rpcAvailable ? "connected" : "backoff",
        appServer: rpcAvailable ? "live" : "unknown" } }),
  });
  const event = (cursor: number, delta: string) => {
    const payload = { method: "item/agentMessage/delta", params: { threadId: "thread", turnId: "turn", itemId: "answer", delta },
      codewideThreadPatch: { version: 1, threadId: "thread", operation: { kind: "itemTextDelta", itemType: "agentMessage", turnId: "turn", itemId: "answer", delta } } };
    mockNative.readCommittedFrames.mockResolvedValueOnce({ baseCursor: cursor - 1, headCursor: cursor,
      frames: [{ cursor, payload: JSON.stringify({ type: "event", cursor, payload }) }] });
    session.receive({ contractVersion: 2, connectionId: "server", type: "journalAdvanced", projectionCursor: cursor, data: "{}" });
  };
  return { details, model, sync, reads, state, event, async close() {
    subscription.unsubscribe(); reconnect.close(); session.stop(); model.close(); await details.close();
  } };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSqlite = new DatabaseSync(":memory:");
  mockTransaction = Promise.resolve();
  mockNative.engineRpc.mockImplementation(async (_id, method) => JSON.stringify({ ok: true,
    result: method === "companion/thread/sync" ? wireSnapshot(1) : { data: [], nextCursor: null } }));
});
afterEach(() => { cleanup(); mockSqlite.close(); jest.useRealTimers(); });

it("repairs an incoming frame with Companion v3, publishes text, ACKs only after projection and reopens", async () => {
  const test = await setup(false);
  const view = render(<Conversation details={test.details} />);
  const repair = Promise.withResolvers<string>();
  mockNative.engineRpc.mockReturnValueOnce(repair.promise);
  await act(async () => { test.event(1, "already in snapshot"); });
  expect(mockNative.acknowledgeProjection).not.toHaveBeenCalled();
  expect(view.queryByText("Recovered")).toBeNull();
  await act(async () => { repair.resolve(JSON.stringify({ ok: true, result: wireSnapshot(1) })); });
  await waitFor(() => expect(view.getByText("Recovered")).toBeVisible());
  await waitFor(() => expect(mockNative.acknowledgeProjection).toHaveBeenCalledWith("server", 1));
  await act(async () => { test.event(2, " incoming"); });
  await waitFor(() => expect(view.getByText("Recovered incoming")).toBeVisible());
  expect(test.details.getThread("server", "thread")?.turns[0]?.items[0]).toMatchObject({ text: "Recovered incoming" });
  view.unmount();
  const reopened = render(<Conversation details={test.details} />);
  await waitFor(() => expect(reopened.getByText("Recovered incoming")).toBeVisible());
  reopened.unmount();
  await test.close();
});

it("does not supersede a healthy history read when projection status changes but RPC stays usable", async () => {
  jest.useFakeTimers();
  const test = await setup(true);
  test.state(true, 1);
  await jest.advanceTimersByTimeAsync(1000);
  expect(test.reads).toHaveBeenCalledTimes(1);
  const response = Promise.withResolvers<string>();
  mockNative.engineRpc.mockReturnValueOnce(response.promise);
  const pending = test.sync.readThread("server", "thread");
  for (let index = 0; index < 50; index += 1) {
    test.state(true, 1, index % 2 ? "validated" : "unvalidated", index % 2 ? "live" : "syncing");
  }
  response.resolve(JSON.stringify({ ok: true, result: wireSnapshot(1) }));
  await expect(pending).resolves.toBeDefined();
  expect(test.details.getThread("server", "thread")?.turns[0]?.items[0]).toMatchObject({ text: "Recovered" });
  await jest.advanceTimersByTimeAsync(1000);
  expect(test.reads).toHaveBeenCalledTimes(2);
  await test.close();
});

it("coalesces repeated capabilities and a real RPC loss without dropping the pending incoming message", async () => {
  jest.useFakeTimers();
  const test = await setup(true);
  const view = render(<Conversation details={test.details} />);
  await act(async () => { test.state(true, 1); });
  await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
  expect(test.reads).toHaveBeenCalledTimes(1);
  expect(test.reads).toHaveBeenLastCalledWith("server", "thread", undefined, true);
  const old = Promise.withResolvers<string>();
  mockNative.engineRpc.mockReturnValueOnce(old.promise);
  const pending = test.sync.readThread("server", "thread");
  const obsolete = expect(pending).rejects.toThrow("History read was superseded");
  await act(async () => {
    for (let i = 0; i < 50; i += 1) test.state(true, 1, i % 2 ? "validated" : "unvalidated");
    test.event(2, " delivered");
    test.state(false, 2, "noDefaultNetwork");
    test.state(true, 3);
    test.state(false, 4, "noDefaultNetwork");
    test.state(true, 5);
    old.resolve(JSON.stringify({ ok: true, result: wireSnapshot(1) }));
    await obsolete;
  });
  await act(async () => { await jest.advanceTimersByTimeAsync(999); });
  expect(test.reads).toHaveBeenCalledTimes(2);
  expect(view.getByText("Recovered delivered")).toBeVisible();
  await act(async () => { await jest.advanceTimersByTimeAsync(1); });
  expect(test.reads).toHaveBeenCalledTimes(3);
  expect(test.reads).toHaveBeenLastCalledWith("server", "thread", undefined, true);
  expect(mockNative.acknowledgeProjection).toHaveBeenCalledWith("server", 2);
  expect(test.model.rows$.peek()[0]).toMatchObject({ state: "live", rpcAvailable: true });
  view.unmount();
  await test.close();
});
