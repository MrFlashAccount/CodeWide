import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Thread, Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadDetailRow } from "../src/data/thread-detail-projection";
import type { TurnUsageProjection } from "@codewide/sync-client";
import { contextUsageFromProjection } from "../src/data/account-rate-limits";
import { threadFailureNotice } from "../src/data/thread-current-outcome";

const platform = vi.hoisted((): { database: DatabaseSync | null; failSql: string; plans: string[] | null; transactionTail: Promise<void> } => ({
  database: null, failSql: "", plans: null, transactionTail: Promise.resolve(),
}));

function sqlValue(value: unknown): SQLInputValue {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  throw new Error("Unsupported test SQL parameter");
}

function database(): DatabaseSync {
  if (platform.database === null) throw new Error("Test database is closed");
  return platform.database;
}

async function execute(sql: string, params: readonly unknown[] = []) {
  if (platform.failSql !== "" && sql.includes(platform.failSql)) throw new Error("Injected SQLite interruption");
  if (platform.plans !== null && sql.startsWith("SELECT") && sql.includes("ORDER BY")) {
    platform.plans.push(...database().prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params.map(sqlValue)).map(({ detail }) => String(detail)));
  }
  return { rows: database().prepare(sql).all(...params.map(sqlValue)) };
}

// WHY: OP-SQLite requires a native JSI runtime. Real SQL executes in Node SQLite instead.
vi.mock("@op-engineering/op-sqlite", () => ({ open: () => ({
  execute,
  executeSync: (sql: string) => ({ rows: database().prepare(sql).all() }),
  transaction: async (operation: (executor: { execute: typeof execute }) => Promise<void>) => {
    // OP-SQLite serializes transaction callbacks on each opened connection.
    const transaction = platform.transactionTail.then(async () => {
      database().exec("BEGIN IMMEDIATE");
      try { await operation({ execute }); database().exec("COMMIT"); }
      catch (cause) { database().exec("ROLLBACK"); throw cause; }
    });
    platform.transactionTail = transaction.catch(() => undefined);
    await transaction;
  },
}) }));
// WHY: Lifecycle events are supplied by Android, which is absent in the Node adapter test.
vi.mock("react-native", () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }));
// WHY: Native cache-file statistics do not exist for an in-memory SQLite database.
vi.mock("expo-file-system/legacy", () => ({ cacheDirectory: "/cache/", getInfoAsync: async () => ({ exists: false }) }));

import { createThreadDetailSqlite, rotateHistoryCache } from "../src/data/thread-detail-sqlite.native";
import { prepareHistoryRelations, persistHistoryRow } from "../src/data/thread-history-relations";
import { historyContentPayload } from "../src/data/thread-history-schema";
import { resolvedHistoryWindowSql } from "../src/data/thread-history-queries";
import { createThreadSummarySqlite } from "../src/data/thread-summary-sqlite.native";
import type { StoredThreadSummary } from "../src/data/thread-summary-types";
import { authoritativeTimelineRowId, pendingTimelineRowId, materializeThreadDetail, projectAuthoritativeHistoryEpoch, reconcileAuthoritativeThreadDetailRow,
  shouldWriteAuthoritativeThreadDetailRow } from "../src/data/thread-detail-projection";
import { materializeThreadSync } from "../src/data/thread-cursor-sync";
import { createThreadDetailDatabase, threadWindowCoverage, type ThreadRemoteLoader } from "../src/data/thread-detail-database.native";

function thread(): Thread {
  return {
    id: "thread", extra: null, sessionId: "session", forkedFromId: null, parentThreadId: null,
    preview: "", ephemeral: false, section: null, sectionEnteredAt: null, historyMode: "paginated",
    modelProvider: "test", createdAt: 1, updatedAt: 2, recencyAt: null, status: { type: "idle" },
    path: null, cwd: "/repo", cliVersion: "test", source: "cli", canAcceptDirectInput: null,
    threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: "History", turns: [],
  };
}

function turn(id: string): Turn {
  return { id, status: "completed", itemsView: "full", error: null, startedAt: 1, completedAt: 2, durationMs: 1,
    items: [{ type: "agentMessage", id: `${id}-answer`, text: `Answer ${id}`, phase: "final_answer", memoryCitation: null }] };
}

function row(id: string, ordinal = 0): ThreadDetailRow {
  return { id, kind: "turn", connectionId: "server", remoteThreadId: "thread", remoteTurnId: id,
    historyEpoch: 0, ordinal, sessionId: null, lastOpenedAt: 0, sealed: true,
    thread: null, turn: turn(id), turnMetadata: null, activityItems: null };
}

function meta(epoch = 0): ThreadDetailRow {
  return { ...row("meta"), kind: "thread", remoteTurnId: null, sealed: false,
    turn: null, thread: thread(), historyEpoch: epoch, historyCursor: "older", historyHadTurns: true,
    historyCoverageMinOrdinal: 0, historyCoverageMaxOrdinal: 2 };
}

function pending(): ThreadDetailRow {
  return { ...row("pending", 10), kind: "pending", sealed: false, remoteTurnId: null, turn: null,
    pending: { commandId: "pending", method: "turn/start", presentation: "delivery", text: "Queued prompt",
      attachments: [], state: "sending", attempts: 1, lastError: null, createdAt: 1, updatedAt: 2, order: 10 } };
}

function seedV4(values: readonly ThreadDetailRow[]): void {
  database().exec(`CREATE TABLE __tanstack_db_sqlite_meta(runtime_id TEXT PRIMARY KEY, schema_version INTEGER);
    INSERT INTO __tanstack_db_sqlite_meta VALUES ('thread-details-v2', 4);
    CREATE TABLE codewide_thread_details(__key TEXT PRIMARY KEY, __payload TEXT NOT NULL,
      connection_id TEXT, thread_id TEXT, turn_id TEXT, history_epoch INTEGER, kind TEXT, ordinal REAL, sealed INTEGER)`);
  for (const value of values) database().prepare(`INSERT INTO codewide_thread_details VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    `string:${value.id}`, JSON.stringify(value), value.connectionId, value.remoteThreadId, value.remoteTurnId,
    value.historyEpoch, value.kind, value.ordinal, value.sealed ? 1 : 0,
  );
}

function seedV5(values: readonly ThreadDetailRow[]): void {
  seedV4(values);
  // Version-labelled physical fixture: v5 stored item arrays and three
  // independent positions. Do not build this with the current schema writer.
  database().exec(`
    CREATE TABLE codewide_history_heads(__key TEXT PRIMARY KEY, connection_id TEXT NOT NULL,
      thread_id TEXT NOT NULL, active_epoch INTEGER NOT NULL, payload TEXT NOT NULL, UNIQUE(connection_id,thread_id));
    CREATE TABLE codewide_history_chains(connection_id TEXT NOT NULL, thread_id TEXT NOT NULL, history_epoch INTEGER NOT NULL,
      cursor TEXT, cursor_known INTEGER NOT NULL DEFAULT 0, had_turns INTEGER, min_ordinal REAL,
      min_known INTEGER NOT NULL DEFAULT 0, max_ordinal REAL, max_known INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(connection_id,thread_id,history_epoch));
    CREATE TABLE codewide_history_content(content_id INTEGER PRIMARY KEY AUTOINCREMENT, __key TEXT NOT NULL,
      connection_id TEXT NOT NULL, thread_id TEXT NOT NULL, turn_id TEXT, kind TEXT NOT NULL, sealed INTEGER NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE codewide_history_members(connection_id TEXT NOT NULL, thread_id TEXT NOT NULL, history_epoch INTEGER NOT NULL,
      __key TEXT NOT NULL, content_id INTEGER NOT NULL, ordinal REAL NOT NULL, PRIMARY KEY(connection_id,thread_id,history_epoch,__key));
    CREATE TABLE codewide_history_pending(__key TEXT PRIMARY KEY, connection_id TEXT NOT NULL, thread_id TEXT NOT NULL,
      history_epoch INTEGER NOT NULL, ordinal REAL NOT NULL, payload TEXT NOT NULL);
    INSERT INTO codewide_history_heads SELECT __key,connection_id,thread_id,history_epoch,
      json_remove(__payload,'$.historyEpoch','$.historyCursor','$.historyHadTurns','$.historyCoverageMinOrdinal','$.historyCoverageMaxOrdinal')
      FROM codewide_thread_details WHERE kind='thread';
    INSERT INTO codewide_history_chains(connection_id,thread_id,history_epoch)
      SELECT DISTINCT connection_id,thread_id,history_epoch FROM codewide_thread_details WHERE kind!='pending';
    INSERT INTO codewide_history_chains SELECT connection_id,thread_id,history_epoch,
      json_extract(__payload,'$.historyCursor'),json_type(__payload,'$.historyCursor') IS NOT NULL,
      json_extract(__payload,'$.historyHadTurns'),json_extract(__payload,'$.historyCoverageMinOrdinal'),
      json_type(__payload,'$.historyCoverageMinOrdinal') IS NOT NULL,json_extract(__payload,'$.historyCoverageMaxOrdinal'),
      json_type(__payload,'$.historyCoverageMaxOrdinal') IS NOT NULL FROM codewide_thread_details WHERE kind='thread'
      ON CONFLICT(connection_id,thread_id,history_epoch) DO UPDATE SET cursor=excluded.cursor,cursor_known=excluded.cursor_known,
      had_turns=excluded.had_turns,min_ordinal=excluded.min_ordinal,min_known=excluded.min_known,max_ordinal=excluded.max_ordinal,max_known=excluded.max_known;
    INSERT INTO codewide_history_content SELECT rowid,__key,connection_id,thread_id,turn_id,kind,sealed,
      json_remove(__payload,'$.historyEpoch','$.ordinal') FROM codewide_thread_details WHERE kind IN ('turn','turnMeta','activity');
    INSERT INTO codewide_history_members SELECT connection_id,thread_id,history_epoch,__key,rowid,ordinal
      FROM codewide_thread_details WHERE kind IN ('turn','turnMeta','activity');
    INSERT INTO codewide_history_pending SELECT __key,connection_id,thread_id,history_epoch,ordinal,__payload
      FROM codewide_thread_details WHERE kind='pending';
    DROP TABLE codewide_thread_details;
    CREATE VIEW codewide_thread_details AS SELECT payload AS __payload FROM codewide_history_heads;
    UPDATE __tanstack_db_sqlite_meta SET schema_version=5;
  `);
}

async function write(storage: ReturnType<typeof createThreadDetailSqlite>, values: readonly ThreadDetailRow[]) {
  storage.begin();
  for (const value of values) storage.write({ type: "update", value });
  await storage.commit({ durable: true });
}

async function reopen(storage: ReturnType<typeof createThreadDetailSqlite>) {
  await storage.close();
  const next = createThreadDetailSqlite(() => undefined);
  await next.prepare();
  return next;
}

async function readThread(storage: ReturnType<typeof createThreadDetailSqlite>) {
  const window = await storage.loadResolvedWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null, turnLimit: 36, newerBuffer: 12 });
  return materializeThreadDetail([...window.turnRows, ...window.detailRows, ...window.liveRows], "server", "thread", "session");
}

beforeEach(() => { platform.database = new DatabaseSync(":memory:"); database().exec("PRAGMA foreign_keys=ON"); platform.failSql = ""; platform.plans = null; platform.transactionTail = Promise.resolve(); });
afterEach(() => { database().close(); platform.database = null; });

describe("sidebar access paths", () => {
  it("keeps catalog rows across index replacement and orders scoped, global, project and subagent lists without sorting", async () => {
    let storage = createThreadSummarySqlite();
    await storage.prepare();
    const value: StoredThreadSummary = { connectionId: "server", remoteThreadId: "a", parentThreadId: null,
      name: "A", preview: "Preview", cwd: "/repo", updatedAt: 10, recencyAt: 10, status: { type: "idle" },
      pinned: false, archived: false, pendingRequestCount: 0, latestActivityCursor: 0, lastSeenCursor: 0, unread: 0, deleteCommandId: null };
    storage.begin();
    for (const next of [value, { ...value, remoteThreadId: "b" }, { ...value, remoteThreadId: "unknown", recencyAt: null },
      { ...value, remoteThreadId: "archived", archived: true }, { ...value, remoteThreadId: "pinned", pinned: true },
      { ...value, remoteThreadId: "child-older", parentThreadId: "a", recencyAt: 9 },
      { ...value, remoteThreadId: "child-newer", parentThreadId: "b", recencyAt: 11 },
      { ...value, remoteThreadId: "foreign", connectionId: "other", recencyAt: 20 },
      { ...value, remoteThreadId: "deleted", deleteCommandId: "delete-intent" }]) storage.write({ type: "insert", value: next });
    await storage.commit({ durable: true });
    await storage.close();
    database().exec(`CREATE INDEX codewide_thread_summaries__idx_root_connection ON codewide_thread_summaries
      (connection_id,parent_thread_id,delete_command_id,archived,pinned,recency_at)`);
    storage = createThreadSummarySqlite();
    await storage.prepare();
    platform.plans = [];
    const request = { connectionId: "server", recentLimit: 10, archivedLimit: 10,
      selectedConnectionId: null, selectedThreadId: null, subagentConnectionId: "server", subagentLimit: 10 };
    const scoped = await storage.loadView(request);
    expect(scoped.recent.map(({ remoteThreadId }) => remoteThreadId)).toEqual(["a", "b", "unknown"]);
    expect(scoped.pinned.map(({ remoteThreadId }) => remoteThreadId)).toEqual(["pinned"]);
    expect(scoped.archived.map(({ remoteThreadId }) => remoteThreadId)).toEqual(["archived"]);
    expect(scoped.subagents.map(({ remoteThreadId }) => remoteThreadId)).toEqual(["child-newer", "child-older"]);
    const global = await storage.loadView({ ...request, connectionId: null });
    expect(global.recent.map(({ remoteThreadId }) => remoteThreadId)).toEqual(["foreign", "a", "b", "unknown"]);
    expect((await storage.loadView({ ...request, projectCwd: "/repo" })).recent).toEqual(scoped.recent);
    expect(platform.plans.some((detail) => detail.startsWith("SEARCH"))).toBe(true);
    expect(platform.plans.filter((detail) => detail.includes("TEMP B-TREE"))).toEqual([]);
    await storage.close();
  });
});

describe("relational thread history", () => {
  const receipt = { threadId: "thread", commandId: "pending", turnId: "sent-turn", itemId: "sent-user" };
  const sentItem = { type: "userMessage", id: receipt.itemId, clientId: receipt.commandId, content: [] } as const;
  const receiptEvent = { cursor: 42, payload: { method: "item/completed",
    params: { threadId: receipt.threadId, turnId: receipt.turnId, item: sentItem },
    codewideThreadPatch: { version: 1, threadId: receipt.threadId, operation: { kind: "itemUpsert" } } } };

  async function seedPendingDelivery() {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", thread(), "initial", null);
    await details.close();
    const storage = createThreadDetailSqlite(() => undefined);
    const authored = { ...pending(), id: pendingTimelineRowId("server", "thread", "pending") };
    await storage.prepare();
    await write(storage, [authored]);
    await storage.close();
    return authored;
  }

  async function readPendingDelivery() {
    const storage = createThreadDetailSqlite(() => undefined);
    const window = await storage.loadResolvedWindow({ connectionId: "server", threadId: "thread",
      anchorTurnId: null, turnLimit: 15, newerBuffer: 0 });
    await storage.close();
    return window.liveRows.find((value) => value.kind === "pending")?.pending;
  }

  it("persists a receipt for an unloaded chat before acknowledging its event, retaining the authored prompt", async () => {
    const authored = await seedPendingDelivery();
    const details = createThreadDetailDatabase();
    await details.prepare();
    expect(details.getThread("server", "thread")).toBeNull();
    const projected = await details.applyEvents("server", [receiptEvent]);
    await projected.checkpoint;
    expect(projected.threads.size).toBe(0);
    expect(details.getThread("server", "thread")).toBeNull();
    expect(await readPendingDelivery()).toMatchObject({ text: authored.pending?.text,
      state: "appServerAccepted", confirmation: receipt });
    await details.close();

    const restarted = createThreadDetailDatabase();
    await restarted.prepare();
    await restarted.applyEvents("server", [receiptEvent, receiptEvent]);
    expect(await readPendingDelivery()).toMatchObject({ state: "appServerAccepted", confirmation: receipt });
    await restarted.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });
    const window = restarted.readWindowRows(restarted.chat.window$("server", "thread").peek());
    expect(window.liveRows.find((value) => value.kind === "pending")?.pending)
      .toMatchObject({ state: "appServerAccepted", confirmation: receipt });
    await restarted.close();
  });

  it("does not regress a durable confirmation when an older pending snapshot is written", async () => {
    const authored = await seedPendingDelivery();
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.confirmCommandReceipts("server", [receipt]);
    await write(storage, [authored]);
    await storage.close();
    expect(await readPendingDelivery()).toMatchObject({ state: "appServerAccepted", confirmation: receipt });
  });

  it("keeps processing receipts after navigation actually evicts the chat", async () => {
    await seedPendingDelivery();
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });
    for (let index = 0; index < 6; index += 1) {
      const id = `other-${index}`;
      await details.importThreadSnapshot("server", { ...thread(), id }, "initial", null);
      await details.loadWindow({ connectionId: "server", threadId: id, anchorTurnId: null });
    }
    expect(details.getThread("server", "thread")).toBeNull();
    await details.applyEvents("server", [receiptEvent]);
    expect(details.getThread("server", "thread")).toBeNull();
    expect(await readPendingDelivery()).toMatchObject({ confirmation: receipt });
    await details.close();
  });

  it("preserves a receipt that beats the staged enqueue continuation and its late rollback", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", thread(), "initial", null);
    const authored = details.createPending({ connectionId: "server", threadId: "thread", commandId: "pending",
      method: "turn/start", presentation: "delivery", text: "Staged prompt", attachments: [],
      state: "queued", attempts: 0, lastError: null, createdAt: 1, updatedAt: 1 });
    const staged = details.stagePendingMutation({ upserts: [authored], deletes: [] });
    // The user item arrives without turn/started: UI repair is unavailable,
    // but its receipt must already be durable and must survive local rollback.
    await expect(details.applyEvents("server", [receiptEvent])).rejects.toThrow("remote loader");
    await details.commitPending(authored, { durable: true });
    staged.rollback();
    expect(await readPendingDelivery()).toMatchObject({ text: "Staged prompt", confirmation: receipt });
    await details.close();
  });

  it("rejects the event when persisting its confirmation fails, and accepts replay after recovery", async () => {
    await seedPendingDelivery();
    const details = createThreadDetailDatabase();
    await details.prepare();
    platform.failSql = "INSERT INTO codewide_history_pending";
    await expect(details.applyEvents("server", [receiptEvent])).rejects.toThrow("Injected SQLite interruption");
    platform.failSql = "";
    expect(await readPendingDelivery()).toMatchObject({ state: "sending" });
    await details.applyEvents("server", [receiptEvent]);
    expect(await readPendingDelivery()).toMatchObject({ state: "appServerAccepted", confirmation: receipt });
    await details.close();
  });

  it("persists snapshot evidence after offline completion without inventing canonical content", async () => {
    await seedPendingDelivery();
    const details = createThreadDetailDatabase();
    await details.prepare();
    const canonical: Turn = { ...turn(receipt.turnId), items: [{ type: "userMessage", id: receipt.itemId,
      clientId: receipt.commandId, content: [] }, ...turn(receipt.turnId).items] };
    await details.applySnapshot("server", [{ archived: false, thread: { ...thread(), turns: [canonical] } }], 50);
    expect(await readPendingDelivery()).toMatchObject({ confirmation: receipt });
    expect(details.getThread("server", "thread")).toBeNull();
    await details.importThreadSnapshot("server", { ...thread(), turns: [canonical] }, "recovery", null);
    expect(await readPendingDelivery()).toBeUndefined();
    await details.close();
    const storage = createThreadDetailSqlite(() => undefined);
    expect((await readThread(storage))?.thread.turns[0]?.items).toEqual(canonical.items);
    await storage.close();
  });

  it("never confirms another server or thread with the same command id", async () => {
    await seedPendingDelivery();
    const storage = createThreadDetailSqlite(() => undefined);
    expect(await storage.confirmCommandReceipts("other-server", [receipt])).toEqual([]);
    expect(await storage.confirmCommandReceipts("server", [{ ...receipt, threadId: "other-thread" }])).toEqual([]);
    expect(await readPendingDelivery()).toMatchObject({ state: "sending" });
    await storage.close();
  });

  it("keeps current usage across history paging and reopening, but accepts a live compaction decrease", async () => {
    const usage = (tokens: number): TurnUsageProjection => {
      const counts = { inputTokens: tokens, cachedInputTokens: 0, outputTokens: 0,
        reasoningOutputTokens: 0, totalTokens: tokens };
      return { version: 1, status: "live", modelContextWindow: 200_000, latestRequest: counts,
        turn: { tokens: counts, cost: null }, thread: { tokens: counts, cost: null } };
    };
    const usedTurn = (id: string, startedAt: number, tokens: number): Turn => {
      const value = { ...turn(id), startedAt, codewide: { usage: usage(tokens) } };
      return value;
    };
    let details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", { ...thread(), turns: [usedTurn("current", 100, 100_000)] }, "initial", "older");
    const request = { connectionId: "server", threadId: "thread", anchorTurnId: null };
    await details.loadWindow(request);
    const currentUsage = () => {
      const snapshot = details.chat.window$("server", "thread").peek();
      const checkpoint = details.chat.readRows(snapshot.liveRowIds).find((value) => value.kind === "thread")?.currentUsage;
      return contextUsageFromProjection(checkpoint?.usage ?? null)?.usedTokens;
    };
    expect(currentUsage()).toBe(100_000);
    const epoch = details.chat.window$("server", "thread").peek().historyEpoch;
    const historical = Array.from({ length: 50 }, (_, index) => usedTurn(`old-${index}`, index, 10_000 + index));
    await details.prependTurns("server", "thread", epoch, historical, null);
    await details.loadWindow({ ...request, anchorTurnId: "old-0" });
    expect(currentUsage()).toBe(100_000);
    expect(details.chat.readRows(details.chat.window$("server", "thread").peek().turnRowIds)
      .some((value) => value.remoteTurnId === "current")).toBe(false);
    await details.close();
    details = createThreadDetailDatabase();
    await details.prepare();
    await details.loadWindow({ ...request, anchorTurnId: "old-0" });
    expect(currentUsage()).toBe(100_000);
    await details.replaceActiveThread("server", { ...thread(), turns: [usedTurn("current", 100, 20_000)] });
    expect(currentUsage()).toBe(20_000);
    await details.replaceActiveThread("server", { ...thread(), turns: [usedTurn("old-0", 0, 150_000)] });
    expect(currentUsage()).toBe(20_000);
    await details.importThreadSnapshot("server", { ...thread(), id: "other", turns: [usedTurn("other-turn", 200, 70_000)] }, "initial", null);
    expect(currentUsage()).toBe(20_000);
    await details.close();
  });
  it("persists the tail failure across paging and restart, and clears it on a new live turn", async () => {
    const failed: Turn = { ...turn("failed"), startedAt: 100, status: "failed",
      error: { message: "Request rejected", codexErrorInfo: null, additionalDetails: null } };
    const failedThread: Thread = { ...thread(), status: { type: "systemError" }, canAcceptDirectInput: true, turns: [failed] };
    let details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", failedThread, "initial", "older");
    const request = { connectionId: "server", threadId: "thread", anchorTurnId: null };
    await details.loadWindow(request);
    const notice = () => {
      const snapshot = details.chat.window$("server", "thread").peek();
      const metadata = details.chat.readRows(snapshot.liveRowIds).find((value) => value.kind === "thread");
      return threadFailureNotice(metadata?.currentOutcome ?? null, metadata?.thread);
    };
    expect(notice()).toEqual({ message: "Request rejected", acceptsInput: true });
    const epoch = details.chat.window$("server", "thread").peek().historyEpoch;
    await details.prependTurns("server", "thread", epoch,
      Array.from({ length: 50 }, (_, index) => ({ ...turn(`old-${index}`), startedAt: index })), null);
    await details.loadWindow({ ...request, anchorTurnId: "old-0" });
    expect(notice()).toEqual({ message: "Request rejected", acceptsInput: true });
    await details.close();
    details = createThreadDetailDatabase();
    await details.prepare();
    await details.loadWindow({ ...request, anchorTurnId: "old-0" });
    expect(notice()).toEqual({ message: "Request rejected", acceptsInput: true });
    await details.replaceActiveThread("server", { ...thread(), turns: [{ ...turn("next"), startedAt: 200, status: "inProgress" }] });
    expect(notice()).toBeNull();
    await details.replaceActiveThread("server", { ...thread(), turns: [failed] });
    expect(notice()).toBeNull();
    await details.close();
  });

  it("shows an honest fallback for a server error without turn details", () => {
    const unavailable: Thread = { ...thread(), status: { type: "systemError" }, canAcceptDirectInput: null };
    expect(threadFailureNotice(null, unavailable)).toEqual({
      message: "The server reported an error. Details are unavailable.", acceptsInput: false,
    });
    expect(threadFailureNotice(null, { ...unavailable, canAcceptDirectInput: true })?.acceptsInput).toBe(true);
    expect(threadFailureNotice(null, thread())).toBeNull();
  });

  it("clears a recovered error from ordered live events even before thread status catches up", async () => {
    const failed: Turn = { ...turn("failed"), startedAt: null, status: "failed",
      error: { message: "Request rejected", codexErrorInfo: null, additionalDetails: null } };
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", { ...thread(), status: { type: "systemError" }, turns: [failed] }, "initial", null);
    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });
    const nextTurn: Turn = { ...turn("next"), startedAt: null, status: "inProgress", completedAt: null, itemsView: "full" };
    const event = (cursor: number, kind: string, value: Turn) => ({ cursor, payload: {
      method: kind === "turnStarted" ? "turn/started" : "turn/completed",
      params: { threadId: "thread", turn: value },
      codewideThreadPatch: { version: 1, threadId: "thread", operation: { kind, turn: value } },
    } });
    await (await details.applyEvents("server", [event(1, "turnStarted", nextTurn)])).checkpoint;
    const metadata = () => details.chat.readRows(details.chat.window$("server", "thread").peek().liveRowIds)
      .find((value) => value.kind === "thread");
    expect(metadata()?.currentOutcome).toMatchObject({ turnId: "next", status: "inProgress" });
    expect(threadFailureNotice(metadata()?.currentOutcome ?? null, metadata()?.thread)).toBeNull();
    await (await details.applyEvents("server", [event(2, "turnCompleted", { ...nextTurn, status: "completed" })])).checkpoint;
    expect(metadata()?.currentOutcome).toMatchObject({ turnId: "next", status: "completed" });
    await details.close();
  });

  it.each([6, 101])("fills a sparse forward range and places an active head from %i after known history", async (headOrdinal) => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    const storedTurn = (ordinal: number): ThreadDetailRow => {
      const value = turn(`t${ordinal}`);
      return { ...row(value.id, ordinal), id: authoritativeTimelineRowId("server", "thread", value), turn: value };
    };
    const head = { ...turn("t101"), status: "inProgress" as const, completedAt: null };
    await write(storage, [
      { ...meta(), id: "server\u0000thread\u0000thread", historyCoverageMinOrdinal: 0, historyCoverageMaxOrdinal: 100 },
      ...Array.from({ length: 8 }, (_, index) => storedTurn(index)), storedTurn(9), storedTurn(100),
      { ...storedTurn(101), ordinal: headOrdinal, sealed: false, turn: head },
    ]);
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: "t0" });
    const loadNewer = vi.fn(async ({ afterTurnId, historyEpoch }: Parameters<ThreadRemoteLoader["loadNewer"]>[0]) => {
      const start = Number(afterTurnId.slice(1)) + 1;
      const page = Array.from({ length: 5 }, (_, index) => turn(`t${start + index}`));
      const result = await details.appendTurnsAfter("server", "thread", historyEpoch, afterTurnId, page, "checkpoint", () => true, undefined);
      return result.accepted
        ? { status: "persisted" as const, lastTurnId: page.at(-1)!.id, hasMore: true }
        : { status: "superseded" as const };
    });
    details.setRemoteLoader({ hydrateWindow: async () => undefined, reconcilePending: async () => undefined,
      repairProjection: async () => undefined, loadOlder: async () => undefined, loadNewer });
    const visible = (): string[] => details.chat.readRows(details.chat.window$("server", "thread").peek().turnRowIds)
      .map((value) => value.remoteTurnId!);
    await expect(details.pullRange("server", "thread", "newer")).resolves.toBe(true);
    expect(visible()).toEqual(["t7", "t6", "t5", "t4", "t3", "t2", "t1", "t0"]);
    expect(loadNewer).not.toHaveBeenCalled();
    await expect(details.pullRange("server", "thread", "newer")).resolves.toBe(true);
    expect(loadNewer).toHaveBeenCalledOnce();
    expect(visible()).toEqual(Array.from({ length: 13 }, (_, index) => `t${12 - index}`));
    expect(visible()).not.toContain("t100");
    const persisted = await storage.loadResolvedWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null, turnLimit: 100, newerBuffer: 5 });
    expect(persisted.liveRows.find((value) => value.remoteTurnId === "t101")).toMatchObject({ ordinal: 101, turn: head });
    expect(await storage.loadThreadMeta("server", "thread")).toMatchObject({ historySourceWitness: "checkpoint" });
    await details.replaceActiveThread("server", { ...thread(), turns: [turn("t101")] });
    const completed = await storage.loadResolvedWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null, turnLimit: 15, newerBuffer: 5 });
    expect(completed.liveRows.find((value) => value.remoteTurnId === "t101")).toMatchObject({ ordinal: 101, turn: turn("t101") });
    expect(await storage.loadThreadMeta("server", "thread")).toMatchObject({ historySourceWitness: "checkpoint" });
    await details.close();
    await storage.close();
  });

  it("fills an older internal gap from the visible anchor rather than the global cursor", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    const values = [0, 18, 19, ...Array.from({ length: 20 }, (_, index) => index + 21)];
    await write(storage, [{ ...meta(), id: "server\u0000thread\u0000thread", historyCoverageMinOrdinal: 0, historyCoverageMaxOrdinal: 40 },
      ...values.map((ordinal) => { const value = turn(`t${ordinal}`); return {
        ...row(value.id, ordinal), id: authoritativeTimelineRowId("server", "thread", value), turn: value,
      }; })]);
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });
    const loadOlder = vi.fn(async () => undefined);
    const loadBefore = vi.fn(async ({ beforeTurnId, historyEpoch }: Parameters<NonNullable<ThreadRemoteLoader["loadBefore"]>>[0]) => {
      expect(beforeTurnId).toBe("t21");
      const result = await details.prependTurnsBefore("server", "thread", historyEpoch, beforeTurnId,
        [16, 17, 18, 19, 20].map((ordinal) => turn(`t${ordinal}`)), true, "before-checkpoint", () => true, undefined);
      return result.accepted ? { status: "persisted" as const, oldestTurnId: "t16", hasMore: true } : { status: "superseded" as const };
    });
    details.setRemoteLoader({ hydrateWindow: async () => undefined, reconcilePending: async () => undefined,
      repairProjection: async () => undefined, loadOlder, loadBefore, loadNewer: async () => ({ status: "superseded" }) });
    await expect(details.pullRange("server", "thread", "older")).resolves.toBe(true);
    await expect(details.pullRange("server", "thread", "older")).resolves.toBe(true);
    expect(loadOlder).not.toHaveBeenCalled();
    expect(loadBefore).toHaveBeenCalledOnce();
    const visible = details.chat.readRows(details.chat.window$("server", "thread").peek().turnRowIds).map((value) => value.ordinal);
    expect(visible).toEqual(Array.from({ length: 25 }, (_, index) => 40 - index));
    expect(details.historyCursor("server", "thread")).toBe("older");
    await details.close();
    await storage.close();
  });

  it("rejects a response whose authority expires during its SQLite lookup", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", { ...thread(), turns: [turn("a")] }, "initial", null);
    let current = true;
    const write = details.appendTurnsAfter("server", "thread", 0, "a", [turn("b")], "checkpoint", () => current, undefined);
    queueMicrotask(() => { current = false; });
    await expect(write).resolves.toMatchObject({ accepted: false });
    expect(details.getThread("server", "thread")?.turns.map((value) => value.id)).toEqual(["a"]);
    const storage = createThreadDetailSqlite(() => undefined);
    expect(await storage.loadTurn("server", "thread", "b", 0)).toBeNull();
    await details.close();
    await storage.close();
  });

  it("reconciles overlapping concurrent pages and rejects their obsolete epoch after a tail switch", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.synchronizeThread({ connectionId: "server", thread: { ...thread(), turns: [turn("a")] },
      mode: "merge", historyCursor: null, throughCursor: 0, expectedLiveRevision: 0, sourceWitness: "initial-checkpoint" });
    const append = () => details.appendTurnsAfter("server", "thread", 0, "a", [turn("b"), turn("c")], "checkpoint", () => true, "initial-checkpoint");
    expect(await Promise.all([append(), append()])).toEqual([
      { accepted: true, historyEpoch: 0 }, { accepted: true, historyEpoch: 0 },
    ]);
    const storage = createThreadDetailSqlite(() => undefined);
    expect((await readThread(storage))?.thread.turns.map((value) => value.id)).toEqual(["a", "b", "c"]);
    await details.mergeTailTurns("server", "thread", [turn("fresh")], null);
    await expect(append()).resolves.toMatchObject({ accepted: false, historyEpoch: 1 });
    expect((await readThread(storage))?.thread.turns.map((value) => value.id)).toEqual(["fresh"]);
    await details.close();
    await storage.close();
  });

  it("rejects a delayed unwitnessed forward page after an older page establishes the current source", async () => {
    const anchor = turn("surviving-anchor");
    seedV5([
      { ...meta(), id: "server\u0000thread\u0000thread", historyCoverageMinOrdinal: 0, historyCoverageMaxOrdinal: 0 },
      { ...row(anchor.id), id: authoritativeTimelineRowId("server", "thread", anchor), turn: anchor },
    ]);
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });
    // Both requests start against the migrated cache before either source witness is known.
    const forwardRequestWitness = details.historySourceWitness("server", "thread");
    const olderRequestWitness = details.historySourceWitness("server", "thread");
    expect(forwardRequestWitness).toBeUndefined();
    expect(olderRequestWitness).toBeUndefined();
    let releaseOldResponse: () => void = () => undefined;
    const oldResponse = new Promise<void>((resolve) => { releaseOldResponse = resolve; });
    const delayedForward = oldResponse.then(() => details.appendTurnsAfter("server", "thread", 0, anchor.id,
      [turn("rolled-back-turn")], "old-source", () => true, forwardRequestWitness));
    await expect(details.prependTurnsBefore("server", "thread", 0, anchor.id,
      [turn("current-older-turn")], false, "current-source", () => true, olderRequestWitness))
      .resolves.toEqual({ accepted: true, historyEpoch: 0 });
    releaseOldResponse();
    await expect(delayedForward).resolves.toEqual({ accepted: false, historyEpoch: 0 });
    expect(details.historySourceWitness("server", "thread")).toBe("current-source");
    await details.close();
    const reopened = createThreadDetailSqlite(() => undefined);
    expect((await readThread(reopened))?.thread.turns.map((value) => value.id)).toEqual(["current-older-turn", anchor.id]);
    expect(await reopened.loadThreadMeta("server", "thread")).toMatchObject({ historySourceWitness: "current-source" });
    expect(await reopened.loadTurn("server", "thread", "rolled-back-turn", 0)).toBeNull();
    await reopened.close();
  });

  it("supersedes pending ranges when a source reset retains the same turn identities", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", { ...thread(), turns: [turn("a")] }, "initial", null);
    await details.synchronizeThread({ connectionId: "server", thread: { ...thread(), turns: [turn("a")] },
      mode: "reset", historyCursor: null, throughCursor: 4, expectedLiveRevision: 0, sourceWitness: "replacement" });
    await expect(details.appendTurnsAfter("server", "thread", 0, "a", [turn("stale")], "previous", () => true, undefined))
      .resolves.toEqual({ accepted: false, historyEpoch: 1 });
    const storage = createThreadDetailSqlite(() => undefined);
    expect(await storage.loadThreadMeta("server", "thread")).toMatchObject({ historyEpoch: 1, historySourceWitness: "replacement" });
    expect((await readThread(storage))?.thread.turns.map((value) => value.id)).toEqual(["a"]);
    await details.close();
    await storage.close();
  });

  it("publishes a forward page separately from durability without evicting the opposite edge", async () => {
    const details = createThreadDetailDatabase();
    await details.prepare();
    await details.importThreadSnapshot("server", { ...thread(), turns: Array.from({ length: 15 }, (_, index) => turn(`t${index}`)) }, "initial", null);
    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });
    const visible = (): string[] => details.chat.readRows(details.chat.window$("server", "thread").peek().turnRowIds).map((value) => value.remoteTurnId!);
    const before = visible();
    const storage = createThreadDetailSqlite(() => undefined);
    details.setRemoteLoader({ hydrateWindow: async () => undefined, reconcilePending: async () => undefined,
      repairProjection: async () => undefined, loadOlder: async () => undefined,
      loadNewer: async ({ afterTurnId, historyEpoch }) => {
        const result = await details.appendTurnsAfter("server", "thread", historyEpoch, afterTurnId,
          Array.from({ length: 5 }, (_, index) => turn(`t${index + 15}`)), "checkpoint", () => true, undefined);
        expect(result.accepted).toBe(true);
        expect(await storage.loadTurn("server", "thread", "t19", historyEpoch)).toMatchObject({ turn: turn("t19") });
        expect(visible()).toEqual(before);
        return { status: "persisted", lastTurnId: "t19", hasMore: false };
      },
    });
    await expect(details.pullRange("server", "thread", "newer")).resolves.toBe(true);
    expect(visible()).toEqual(Array.from({ length: 20 }, (_, index) => `t${19 - index}`));
    await details.close();
    await storage.close();
  });

  it("persists the migration, revision links and pending delivery across closing the SQLite connection", async () => {
    const directory = mkdtempSync(join(tmpdir(), "codewide-history-migration-"));
    const path = join(directory, "history.db");
    database().close();
    platform.database = new DatabaseSync(path);
    database().exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL");
    try {
      seedV5([meta(), row("a"), pending()]);
      let storage = createThreadDetailSqlite(() => undefined);
      await storage.prepare();
      await write(storage, [meta(1), { ...row("a", 7), historyEpoch: 1 }]);
      await storage.close();
      database().close();
      platform.database = new DatabaseSync(path);
      database().exec("PRAGMA foreign_keys=ON");
      storage = createThreadDetailSqlite(() => undefined);
      await storage.prepare();
      const loaded = await storage.loadWindow({ connectionId: "server", threadId: "thread", historyEpoch: 1, maxOrdinal: null, turnLimit: 36 });
      expect(loaded.turnRows).toEqual([{ ...row("a", 7), historyEpoch: 1 }]);
      expect(loaded.liveRows).toContainEqual(pending());
      expect(database().prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(database().prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      await storage.close();
    } finally {
      database().close();
      platform.database = new DatabaseSync(":memory:");
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("migrates v5 items in order, repairs overlay position from its turn and reopens", async () => {
    const value = row("a", 7);
    const activity: ThreadDetailRow = { ...row("activity", 99), remoteTurnId: "a", kind: "activity", turn: null,
      activityItems: [...turn("first").items, ...turn("second").items] };
    seedV5([meta(), value, activity, pending()]);
    let storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    storage = await reopen(storage);
    const loaded = await storage.loadWindow({ connectionId: "server", threadId: "thread", historyEpoch: 0, maxOrdinal: null, turnLimit: 36 });
    expect(loaded.turnRows).toEqual([value]);
    expect(loaded.detailRows).toEqual([{ ...activity, ordinal: 7 }]);
    expect(loaded.liveRows).toContainEqual(pending());
    expect(database().prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    await storage.close();
  });

  it("rolls back v5 table replacement and item extraction before retrying", async () => {
    seedV5([meta(), row("a"), pending()]);
    const storage = createThreadDetailSqlite(() => undefined);
    platform.failSql = "ALTER TABLE codewide_history_members_v6";
    await expect(storage.prepare()).rejects.toThrow("Injected SQLite interruption");
    expect(database().prepare("SELECT schema_version FROM __tanstack_db_sqlite_meta").get()).toMatchObject({ schema_version: 5 });
    const old = database().prepare("SELECT json_extract(payload,'$.turn.items[0].text') AS text FROM codewide_history_content").get();
    expect(old).toEqual({ text: "Answer a" });
    platform.failSql = "";
    await storage.prepare();
    expect((await readThread(storage))?.thread.turns[0]?.items).toEqual(turn("a").items);
    await storage.close();
  });

  it("does not silently migrate already corrupt cross-thread v5 membership", async () => {
    seedV5([meta(), row("a"), pending()]);
    database().exec("INSERT INTO codewide_history_chains(connection_id,thread_id,history_epoch) VALUES('server','other',0); UPDATE codewide_history_members SET thread_id='other'");
    const storage = createThreadDetailSqlite(() => undefined);
    await expect(storage.prepare()).rejects.toThrow(/FOREIGN KEY/);
    expect(database().prepare("SELECT schema_version FROM __tanstack_db_sqlite_meta").get()).toEqual({ schema_version: 5 });
    expect(database().prepare("SELECT COUNT(*) AS count FROM codewide_history_pending").get()).toEqual({ count: 1 });
    expect(database().prepare("SELECT json_extract(payload,'$.turn.items[0].text') AS text FROM codewide_history_content").get()).toEqual({ text: "Answer a" });
  });

  it("rejects cross-thread, cross-server and cross-identity content membership", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    await write(storage, [meta(), row("a")]);
    const revision = database().prepare("SELECT content_id FROM codewide_history_content").get()?.content_id;
    if (typeof revision !== "number") throw new Error("Missing fixture revision");
    for (const [connection, threadId, turnId, key] of [
      ["server", "other", "a", "string:a"], ["other", "thread", "a", "string:a"],
      ["server", "thread", "other", "string:a"], ["server", "thread", "a", "wrong-key"],
    ]) {
      database().prepare("INSERT OR IGNORE INTO codewide_history_chains(connection_id,thread_id,history_epoch) VALUES(?,?,1)").run(connection!, threadId!);
      database().prepare("INSERT OR IGNORE INTO codewide_history_turns VALUES(?,?,1,?,0)").run(connection!, threadId!, turnId!);
      expect(() => database().prepare("INSERT INTO codewide_history_members VALUES(?,?,1,?,?,?)")
        .run(connection!, threadId!, key!, revision, turnId!)).toThrow(/FOREIGN KEY/);
    }
    expect((await readThread(storage))?.thread.turns.map(({ id }) => id)).toEqual(["a"]);
    await storage.close();
  });

  it("moves a turn family atomically and ignores a stale overlay position", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    const activity: ThreadDetailRow = { ...row("activity", 4), remoteTurnId: "a", kind: "activity", turn: null, activityItems: turn("a").items };
    await write(storage, [meta(), row("a", 4), activity]);
    await write(storage, [row("a", 8), activity]);
    const loaded = await storage.loadAdjacentWindow({ connectionId: "server", threadId: "thread", historyEpoch: 0,
      boundaryOrdinal: 7, direction: "newer", turnLimit: 1 });
    expect(loaded.turnRows.map(({ ordinal }) => ordinal)).toEqual([8]);
    expect(loaded.detailRows).toEqual([{ ...activity, ordinal: 8 }]);
    await storage.close();
  });

  it("bounds old chain retention without dropping shared items or delivery intents", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    await write(storage, [pending()]);
    for (let epoch = 0; epoch < 8; epoch += 1) await write(storage, [meta(epoch), { ...row("a"), historyEpoch: epoch }]);
    await rotateHistoryCache({ execute });
    expect(database().prepare("SELECT history_epoch FROM codewide_history_chains ORDER BY history_epoch").all())
      .toEqual([{ history_epoch: 6 }, { history_epoch: 7 }]);
    expect((await readThread(storage))?.thread.turns[0]?.items).toEqual(turn("a").items);
    expect(database().prepare("SELECT COUNT(*) AS count FROM codewide_history_content").get()).toEqual({ count: 1 });
    expect(database().prepare("SELECT COUNT(*) AS count FROM codewide_history_pending").get()).toEqual({ count: 1 });
    await storage.close();
  });

  it("keeps outbox rows when removing a thread's history head", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    await write(storage, [meta(), row("a"), pending()]);
    storage.begin(); storage.write({ type: "delete", key: "meta" }); await storage.commit({ durable: true });
    await rotateHistoryCache({ execute });
    expect(await storage.loadThreadMeta("server", "thread")).toBeNull();
    expect(database().prepare("SELECT COUNT(*) AS count FROM codewide_history_items").get()).toEqual({ count: 0 });
    expect(database().prepare("SELECT COUNT(*) AS count FROM codewide_history_pending").get()).toEqual({ count: 1 });
    await storage.close();
  });

  it("uses scoped index walks for a viewport, not full history scans or pre-limit sorting", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    await write(storage, [meta(), ...Array.from({ length: 100 }, (_, index) => row(`turn-${index}`, index))]);
    // The query owner guarantees scope-first keyset access. Exact index names
    // and planner node ids are deliberately not part of this performance contract.
    const plan = database().prepare(`EXPLAIN QUERY PLAN ${resolvedHistoryWindowSql()}`).all("server", "thread", "turn-20", 10, 3);
    const operations = plan.map(({ detail }) => String(detail));
    expect(operations.filter((detail) => /^SCAN (?:p|m|c|codewide_history_\w+)(?: |$)/.test(detail))).toEqual([]);
    // Only the already bounded, combined result may need a final sort.
    expect(operations.filter((detail) => detail.includes("TEMP B-TREE FOR ORDER BY"))).toHaveLength(1);
    const loaded = await storage.loadResolvedWindow({ connectionId: "server", threadId: "thread", anchorTurnId: "turn-20", turnLimit: 10, newerBuffer: 3 });
    expect(loaded.turnRows.map(({ ordinal }) => ordinal)).toEqual([23, 22, 21, 20, 19, 18, 17, 16, 15, 14]);
    await storage.close();
  });

  it("reads bounded ranges and durable anchoring facts without borrowing another thread's history", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    await write(storage, [meta(), row("a", 10), row("b", 11), row("c", 12), row("far", 100),
      { ...meta(), id: "other-meta", remoteThreadId: "other" },
      { ...row("other-a", 999), remoteThreadId: "other", remoteTurnId: "a" }]);
    const scope = { connectionId: "server", threadId: "thread", historyEpoch: 0 };
    expect((await storage.loadWindow({ ...scope, maxOrdinal: 12, turnLimit: 2 })).turnRows.map(({ id }) => id)).toEqual(["c", "b"]);
    expect(await storage.loadTurn("server", "thread", "a", 0)).toEqual(row("a", 10));
    expect(await storage.loadTurn("server", "thread", "a", 1)).toBeNull();
    expect(await storage.loadBoundary("server", "thread", 0, "asc")).toEqual(row("a", 10));
    expect(await storage.loadBoundary("server", "thread", 0, "desc")).toEqual(row("far", 100));
    expect((await storage.loadAdjacentWindow({ ...scope, boundaryOrdinal: 12, direction: "older", turnLimit: 1 })).turnRows)
      .toEqual([row("b", 11)]);
    expect((await storage.loadAdjacentWindow({ ...scope, boundaryOrdinal: 11, direction: "newer", turnLimit: 1 })).turnRows)
      .toEqual([row("c", 12)]);
    const prepend = await storage.loadPrependFacts("server", "thread", 0, ["far"]);
    expect(prepend).toEqual([row("far", 100), row("a", 10)]);
    const authoritative = await storage.loadAuthoritativeFacts("server", "thread", ["a", "unseen"]);
    expect(authoritative).toContainEqual(meta());
    expect(authoritative.filter(({ kind }) => kind === "turn").map(({ id }) => id).sort()).toEqual(["a", "b", "far"]);
    await storage.close();
  });
  it("keeps another persistence runtime untouched and starts an empty database", async () => {
    database().exec("CREATE TABLE other_runtime(value TEXT); INSERT INTO other_runtime VALUES ('retained')");
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    expect(await storage.loadThreadMeta("server", "thread")).toBeNull();
    expect(database().prepare("SELECT value FROM other_runtime").get()).toMatchObject({ value: "retained" });
    await storage.close();
  });

  it("discards an abandoned logical transaction before a following writer commits", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    storage.begin();
    storage.write({ type: "insert", value: pending() });
    storage.rollback();
    await write(storage, [meta(), row("a")]);
    const loaded = await storage.loadWindow({ connectionId: "server", threadId: "thread", historyEpoch: 0, maxOrdinal: null, turnLimit: 36 });
    expect(loaded.liveRows.some((value) => value.kind === "pending")).toBe(false);
    expect(loaded.turnRows.map(({ remoteTurnId }) => remoteTurnId)).toEqual(["a"]);
    await storage.close();
  });

  it("resolves an anchored range with its activity and pending overlays in one native read", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    const activity: ThreadDetailRow = { ...row("activity", 4), remoteTurnId: "turn-4", kind: "activity", turn: null,
      activityItems: turn("turn-4").items };
    await write(storage, [meta(), ...Array.from({ length: 12 }, (_, index) => row(`turn-${index + 1}`, index + 1)), activity, pending()]);
    const queries = vi.spyOn(database(), "prepare");
    const loaded = await storage.loadResolvedWindow({ connectionId: "server", threadId: "thread", anchorTurnId: "turn-4", turnLimit: 12, newerBuffer: 6 });
    // One native read per resolved window is the adapter's declared bridge-latency contract.
    expect(queries).toHaveBeenCalledTimes(1);
    queries.mockRestore();
    expect(loaded.turnRows.map(({ ordinal }) => ordinal)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(loaded.detailRows).toContainEqual(activity);
    expect(loaded.liveRows).toContainEqual(pending());
    expect(loaded.latestSealedOrdinal).toBe(12);
    await storage.close();
  });

  it("accounts actual UTF-8 content bytes once across chains and transaction rollback", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    const value: ThreadDetailRow = { ...row("a"), turn: { ...turn("a"), items: [
      { type: "agentMessage", id: "answer", text: "ёж", phase: "final_answer", memoryCitation: null },
    ] } };
    await write(storage, [meta(), value, pending()]);
    const actual = () => database().prepare(`SELECT COALESCE(SUM(LENGTH(CAST(${historyContentPayload()} AS BLOB))),0) AS history_bytes FROM codewide_history_content c WHERE sealed=1`).get();
    const accounted = () => database().prepare("SELECT history_bytes FROM codewide_thread_detail_cache_meta").get();
    const before = accounted();
    expect(before).toEqual(actual());
    await write(storage, [meta(1), { ...value, historyEpoch: 1 }]);
    expect(accounted()).toEqual(before);
    database().exec("BEGIN");
    await persistHistoryRow({ execute }, { ...row("b"), historyEpoch: 1 });
    expect(accounted()).toEqual(actual());
    database().exec("ROLLBACK");
    expect(accounted()).toEqual(before);
    storage.begin();
    storage.write({ type: "delete", key: "a" });
    await storage.commit({ durable: true });
    expect(accounted()).toMatchObject({ history_bytes: 0 });
    await storage.close();
  });

  it("migrates v4 history, full activity, coverage and pending delivery without clearing the cache", async () => {
    const activity: ThreadDetailRow = { ...row("activity", 0), kind: "activity", remoteTurnId: "a", turn: null,
      activityItems: turn("a").items };
    seedV4([meta(), row("a"), row("b", 2), activity, pending()]);
    let storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    expect((await readThread(storage))?.thread.turns.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(await storage.loadThreadMeta("server", "thread")).toMatchObject({ historyEpoch: 0, historyCursor: "older",
      historyHadTurns: true, historyCoverageMinOrdinal: 0, historyCoverageMaxOrdinal: 2 });
    storage = await reopen(storage);
    const loaded = await storage.loadWindow({ connectionId: "server", threadId: "thread", historyEpoch: 0, maxOrdinal: null, turnLimit: 36 });
    expect(loaded.detailRows).toContainEqual(activity);
    expect(loaded.liveRows).toContainEqual(pending());
    expect(database().prepare("SELECT type FROM sqlite_master WHERE name='codewide_thread_details'").get()).toMatchObject({ type: "view" });
    await storage.close();
  });

  it("rolls back an interrupted migration and retries without losing v4 data", async () => {
    seedV4([meta(), row("a"), pending()]);
    const storage = createThreadDetailSqlite(() => undefined);
    platform.failSql = "CREATE VIEW";
    await expect(storage.prepare()).rejects.toThrow("Injected SQLite interruption");
    expect(database().prepare("SELECT schema_version FROM __tanstack_db_sqlite_meta").get()).toMatchObject({ schema_version: 4 });
    expect(database().prepare("SELECT COUNT(*) AS count FROM codewide_thread_details").get()).toMatchObject({ count: 3 });
    platform.failSql = "";
    await storage.prepare();
    expect((await readThread(storage))?.thread.turns.map(({ id }) => id)).toEqual(["a"]);
    await storage.close();
  });

  it("keeps content when a new chain changes positions, including reopening and a current response", async () => {
    const existing = [meta(), row("a"), row("b", 2)];
    seedV4(existing);
    let storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    const revisions = database().prepare("SELECT content_id FROM codewide_history_content ORDER BY content_id").all();
    const epoch = projectAuthoritativeHistoryEpoch(existing, ["a", "b"]);
    expect(epoch).not.toBe(0);
    const next = existing.filter((value) => value.kind === "turn").map((previous, ordinal) => {
      const linked = reconcileAuthoritativeThreadDetailRow(previous, { ...previous, historyEpoch: epoch, ordinal });
      expect(shouldWriteAuthoritativeThreadDetailRow(previous, linked)).toBe(true);
      return linked;
    });
    await write(storage, [{ ...meta(epoch), historyCoverageMaxOrdinal: 1 }, ...next]);
    // Revision identity is the declared reuse contract, not a generated-id fixture.
    expect(database().prepare("SELECT content_id FROM codewide_history_content ORDER BY content_id").all()).toEqual(revisions);
    storage = await reopen(storage);
    const cached = (await readThread(storage))?.thread ?? null;
    expect(cached?.turns.map(({ id }) => id)).toEqual(["a", "b"]);
    const synchronized = materializeThreadSync(cached, { readModelVersion: 3, throughCursor: 0, thread: thread(),
      history: { kind: "current", headTurnId: "b", turns: [], hasMore: false, olderCursor: null }, activeTurn: null }, "older");
    expect(synchronized.thread.turns.map(({ items }) => items)).toEqual([turn("a").items, turn("b").items]);
    await storage.close();
  });

  it("does not rewrite an earlier chain when the same turn receives a new content revision", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    await write(storage, [meta(), row("a")]);
    const changed: ThreadDetailRow = { ...row("a"), historyEpoch: 1, turn: turn("corrected") };
    await write(storage, [meta(1), changed]);
    expect((await readThread(storage))?.thread.turns[0]?.items).toEqual(turn("corrected").items);
    await write(storage, [meta()]);
    expect((await readThread(storage))?.thread.turns[0]?.items).toEqual(turn("a").items);
    await storage.close();
  });

  it("loads a retained inactive turn family by id for a new cursor page", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    await write(storage, [meta(), row("cached-full")]);
    await write(storage, [
      { ...meta(1), historyCoverageMinOrdinal: 0, historyCoverageMaxOrdinal: 0 },
      { ...row("active-tail"), historyEpoch: 1 },
    ]);

    const facts = await storage.loadPrependFacts("server", "thread", 1, ["cached-full"]);

    expect(facts).toContainEqual(expect.objectContaining({
      kind: "turn",
      remoteTurnId: "cached-full",
      historyEpoch: 0,
      turn: expect.objectContaining({ itemsView: "full", items: turn("cached-full").items }),
    }));
    await storage.close();
  });

  it("reclaims superseded streaming revisions without deleting a revision retained by another chain", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    await write(storage, [meta(), row("a")]);
    await write(storage, [meta(1), { ...row("a"), historyEpoch: 1 }]);
    for (let index = 0; index < 10; index += 1) {
      await write(storage, [{ ...row("a"), historyEpoch: 1, sealed: false, turn: turn(`stream-${index}`) }]);
    }
    expect(database().prepare("SELECT COUNT(*) AS count FROM codewide_history_content").get()).toMatchObject({ count: 2 });
    expect((await readThread(storage))?.thread.turns[0]?.id).toBe("stream-9");
    await write(storage, [meta()]);
    expect((await readThread(storage))?.thread.turns[0]?.id).toBe("a");
    await storage.close();
  });

  it("keeps a damaged old chain recoverable without inventing membership in the active chain", async () => {
    seedV4([meta(9), { ...row("a"), historyEpoch: 8 }]);
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    expect(await storage.loadThreadMeta("server", "thread")).toMatchObject({ historyHadTurns: true, historyEpoch: 9 });
    expect((await readThread(storage))?.thread.turns).toEqual([]);
    const window = await storage.loadResolvedWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null, turnLimit: 36, newerBuffer: 12 });
    expect(threadWindowCoverage({ anchorTurnId: null }, window).complete).toBe(false);
    expect(database().prepare("SELECT COUNT(*) AS count FROM codewide_history_content").get()).toMatchObject({ count: 1 });
    await write(storage, [meta(10), { ...row("a"), historyEpoch: 10 }]);
    expect((await readThread(storage))?.thread.turns.map(({ id }) => id)).toEqual(["a"]);
    await storage.close();
  });

  it("repairs a migrated cache miss before publishing ready, then survives repeated thread switching", async () => {
    // v4 identity format is part of the migration's backward compatibility contract.
    const damaged = { ...meta(9), id: "server\u0000thread\u0000thread" };
    seedV4([damaged, { ...row("a"), historyEpoch: 8 }]);
    const details = createThreadDetailDatabase();
    await details.prepare();
    let releaseHydration: () => void = () => undefined;
    const hydrationGate = new Promise<void>((resolve) => { releaseHydration = resolve; });
    const hydration = vi.fn(async (input: Parameters<ThreadRemoteLoader["hydrateWindow"]>[0]) => {
      if (input.request.threadId !== "thread") return;
      await hydrationGate;
      await details.replaceThreadSnapshot("server", { ...thread(), turns: [turn("a"), turn("b")] }, "recovery", null);
    });
    details.setRemoteLoader({ hydrateWindow: hydration, reconcilePending: async () => undefined, repairProjection: async () => undefined, loadOlder: async () => undefined, loadNewer: async () => ({ status: "superseded" }) });
    const opening = details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });
    await vi.waitFor(() => expect(hydration).toHaveBeenCalledTimes(1));
    expect(details.chat.window$("server", "thread").peek().status).toBe("initial-loading");
    releaseHydration();
    await opening;
    expect(details.getThread("server", "thread")?.turns.map(({ id }) => id)).toEqual(["a", "b"]);
    for (let index = 0; index < 6; index += 1) {
      const id = `other-${index}`;
      await details.importThreadSnapshot("server", { ...thread(), id, turns: [turn(id)] }, "initial", null);
      await details.loadWindow({ connectionId: "server", threadId: id, anchorTurnId: null });
    }
    await details.loadWindow({ connectionId: "server", threadId: "thread", anchorTurnId: null });
    expect(details.getThread("server", "thread")?.turns.map(({ id }) => id)).toEqual(["a", "b"]);
    await details.close();
  });

  it("protects off-window canonical content from a late pending mirror", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    await write(storage, [meta(), { ...row("pending"), turn: turn("canonical") }]);
    await write(storage, [pending()]);
    expect((await readThread(storage))?.thread.turns[0]?.id).toBe("canonical");
    expect(database().prepare("SELECT COUNT(*) AS count FROM codewide_history_pending").get()).toMatchObject({ count: 0 });
    await storage.close();
  });

  it("rejects a newer schema without altering its version", async () => {
    seedV4([meta(), row("a")]);
    database().exec("UPDATE __tanstack_db_sqlite_meta SET schema_version=99");
    await expect(prepareHistoryRelations({ execute })).rejects.toThrow("Unsupported thread history schema version");
    expect(database().prepare("SELECT schema_version FROM __tanstack_db_sqlite_meta").get()).toMatchObject({ schema_version: 99 });
  });

  it("rolls back both the active chain and membership on a failed publication", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    await write(storage, [meta(), row("a")]);
    database().exec("BEGIN");
    await persistHistoryRow({ execute }, meta(1));
    await persistHistoryRow({ execute }, { ...row("b"), historyEpoch: 1 });
    database().exec("ROLLBACK");
    expect((await readThread(storage))?.thread.turns.map(({ id }) => id)).toEqual(["a"]);
    await storage.close();
  });

  it("rotates whole families and keeps pending rows and proof of evicted history", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    await write(storage, [meta(), ...Array.from({ length: 8 }, (_, ordinal) => row(`turn-${ordinal}`, ordinal)), pending()]);
    const rotated = await rotateHistoryCache({ execute }, { softLimitBytes: 900, hardLimitBytes: 1200 });
    expect(rotated.historyFamiliesEvicted).toBeGreaterThan(0);
    const loaded = await storage.loadWindow({ connectionId: "server", threadId: "thread", historyEpoch: 0, maxOrdinal: null, turnLimit: 36 });
    expect(loaded.turnRows.some(({ remoteTurnId }) => remoteTurnId === "turn-0")).toBe(false);
    expect(loaded.turnRows.some(({ remoteTurnId }) => remoteTurnId === "turn-7")).toBe(true);
    expect(loaded.liveRows).toContainEqual(pending());
    expect(await storage.loadThreadMeta("server", "thread")).toMatchObject({ historyHadTurns: true });
    await storage.close();
  });
});
