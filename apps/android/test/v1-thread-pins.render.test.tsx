import type { RpcClient } from "@codewide/sync-client";
import { createThreadPinsCatalog } from "../src/data/threadPinsCatalog";
import { createThreadSummaryDatabase } from "../src/data/thread-summary-database.native";
import { catalogThread, sqliteFixture } from "./thread-catalog-pagination.fixture";

let mockSqlite: ReturnType<typeof sqliteFixture>;
jest.mock("../src/data/ui-cache-persistence.native", () => ({
  getUiCacheSqliteDatabase: () => mockSqlite.database,
}));
beforeEach(() => { mockSqlite = sqliteFixture(); });
afterEach(async () => { await mockSqlite.settled(); mockSqlite.native.close(); });

it("restores a pinned chat outside recent pagination on an empty device and keeps archive membership", async () => {
  const summaries = createThreadSummaryDatabase();
  const old = catalogThread(1000);
  const rpc = jest.fn(async (method: string) => {
    if (method === "companion/thread/pins/list") {
      return { archivedThreadIds: [old.id], cursor: 8, threadIds: [old.id] };
    }
    return { thread: old };
  });
  // WHY: RpcClient has a caller-selected generic return type; the production
  // adapter validates the fixture's RPC DTO before using it.
  const session = { rpc } as unknown as RpcClient;
  const pins = createThreadPinsCatalog({ getSession: () => session, getSummaries: () => summaries });
  await summaries.prepare();
  await pins.ensure("server");
  expect(await summaries.get("server", old.id)).toMatchObject({ pinned: true, pinCursor: 8, archived: true });
  expect(rpc).toHaveBeenCalledWith("thread/read", { includeTurns: false, threadId: old.id });
  await pins.ensure("server");
  expect(rpc).toHaveBeenCalledTimes(2);
  pins.invalidate("server");
  await pins.ensure("server");
  expect(rpc).toHaveBeenCalledTimes(3);
  summaries.close();
});

it("rejects malformed snapshots without wiping confirmed pins", async () => {
  const summaries = createThreadSummaryDatabase();
  await summaries.prepare();
  await summaries.mergeSnapshots("server", [{ archived: false, thread: catalogThread(1) }]);
  await summaries.applyPinSnapshot("server", { cursor: 4, threadIds: ["thread-1"] });
  // WHY: The generic client boundary intentionally returns a malformed DTO;
  // production validation must reject it without replacing persisted state.
  const session = { rpc: async () => ({ cursor: "bad", threadIds: [] }) } as unknown as RpcClient;
  const pins = createThreadPinsCatalog({ getSession: () => session, getSummaries: () => summaries });
  await expect(pins.ensure("server")).rejects.toThrow("invalid pin snapshot");
  expect(await summaries.get("server", "thread-1")).toMatchObject({ pinned: true, pinCursor: 4 });
  summaries.close();
});

it("keeps newer server metadata when an older pin snapshot finishes hydrating", async () => {
  const summaries = createThreadSummaryDatabase();
  await summaries.prepare();
  const old = catalogThread(1000);
  // WHY: The RPC adapter validates both DTOs; this models an unpin committed
  // between reading pin membership and reading the missing thread shell.
  const session = { rpc: async (method: string) => method === "companion/thread/pins/list"
    ? { archivedThreadIds: [], cursor: 8, threadIds: [old.id] }
    : { thread: { ...old, codewide: { threadPin: { cursor: 9, pinned: false, version: 1 } } } }
  } as unknown as RpcClient;
  const pins = createThreadPinsCatalog({ getSession: () => session, getSummaries: () => summaries });
  await pins.ensure("server");
  expect(await summaries.get("server", old.id)).toMatchObject({ pinned: false, pinCursor: 9 });
  summaries.close();
});

it("repeats a pending read after invalidation instead of losing another device's pin change", async () => {
  const summaries = createThreadSummaryDatabase();
  await summaries.prepare();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let reads = 0;
  const rpc = jest.fn(async () => {
    reads += 1;
    if (reads === 1) { await gate; }
    return { archivedThreadIds: [], cursor: reads, threadIds: [] };
  });
  // WHY: The production adapter validates the complete empty snapshot DTO.
  const session = { rpc } as unknown as RpcClient;
  const pins = createThreadPinsCatalog({ getSession: () => session, getSummaries: () => summaries });
  const initial = pins.ensure("server");
  const forced = pins.ensure("server", true);
  if (release === undefined) { throw new Error("Snapshot gate is missing"); }
  release();
  await Promise.all([initial, forced]);
  expect(reads).toBe(2);
  await pins.ensure("server");
  expect(reads).toBe(2);
  summaries.close();
});

async function seedLegacyPins(): Promise<void> {
  const summaries = createThreadSummaryDatabase();
  await summaries.prepare();
  await summaries.mergeSnapshots("server", [{ archived: false, thread: catalogThread(1) }]);
  await summaries.mergeSnapshots("other", [{ archived: false, thread: catalogThread(2) }]);
  await summaries.markUnread("server", "thread-1");
  summaries.close();
  await mockSqlite.settled();
  // The retired app had no pin cursor. Seed its persisted payload before upgrading.
  mockSqlite.native.exec(`UPDATE codewide_thread_summaries SET pinned = 1,
    __payload = json_remove(json_set(__payload, '$.pinned', json('true')), '$.pinCursor')`);
}

it("keeps offline imports through restart, scopes them by server and clears only durable acknowledgements", async () => {
  await seedLegacyPins();
  const initial = createThreadSummaryDatabase();
  const failedRpc = jest.fn(async () => { throw new Error("Disconnected before acknowledgement"); });
  // WHY: The RPC rejects before producing a generic DTO; all local persistence remains real SQLite.
  const offline = { rpc: failedRpc } as unknown as RpcClient;
  const pending = createThreadPinsCatalog({ getSession: () => offline, getSummaries: () => initial });
  await expect(pending.ensure("server")).rejects.toThrow("Disconnected");
  expect(await initial.loadPendingPinMigration("server")).toEqual(["thread-1"]);
  expect(await initial.get("server", "thread-1")).toMatchObject({ unread: 1 });
  initial.close();
  await mockSqlite.settled();

  const reopened = createThreadSummaryDatabase();
  const rpc = jest.fn(async (method: string) => method === "companion/thread/pins/import"
    ? { cursor: 7 }
    : { archivedThreadIds: [], cursor: 7, threadIds: ["thread-1"] });
  // WHY: Production validates the import receipt and snapshot returned by this generic fixture.
  const online = { rpc } as unknown as RpcClient;
  const pins = createThreadPinsCatalog({ getSession: () => online, getSummaries: () => reopened });
  await pins.ensure("server");
  expect(rpc).toHaveBeenNthCalledWith(1, "companion/thread/pins/import", { threadIds: ["thread-1"] });
  expect(await reopened.loadPendingPinMigration("server")).toEqual([]);
  expect(await reopened.loadPendingPinMigration("other")).toEqual(["thread-2"]);
  expect(await reopened.get("server", "thread-1")).toMatchObject({ pinned: true, pinCursor: 7, unread: 1 });
  await pins.ensure("server", true);
  expect(rpc.mock.calls.filter(([method]) => method === "companion/thread/pins/import")).toHaveLength(1);
  reopened.close();
  await mockSqlite.settled();
  const acknowledged = createThreadSummaryDatabase();
  expect(await acknowledged.loadPendingPinMigration("server")).toEqual([]);
  acknowledged.close();
});

it("retains the migration batch when the server returns an invalid acknowledgement", async () => {
  await seedLegacyPins();
  const summaries = createThreadSummaryDatabase();
  const rpc = jest.fn(async () => ({ cursor: "invalid" }));
  // WHY: The deliberately malformed generic RPC receipt must be rejected at the adapter boundary.
  const session = { rpc } as unknown as RpcClient;
  const pins = createThreadPinsCatalog({ getSession: () => session, getSummaries: () => summaries });
  await expect(pins.ensure("server")).rejects.toThrow("invalid pin import acknowledgement");
  await expect(pins.ensure("server")).rejects.toThrow("invalid pin import acknowledgement");
  expect(await summaries.loadPendingPinMigration("server")).toEqual(["thread-1"]);
  expect(rpc).toHaveBeenCalledTimes(2);
  summaries.close();
});
