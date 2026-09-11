import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SqliteExecutor, SqliteValue } from "@codewide/tanstack-db-sqlite";
import { summary } from "./fixtures/thread-summary";
import type { ThreadSummaryViewRequest } from "../src/data/thread-summary-model";

const sqlite = await vi.hoisted(async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const native = new DatabaseSync(":memory:");
  const executor = {
    async execute(sql: string, params: readonly SqliteValue[] = []) {
      const values = params.map((value) => {
        if (value === null || typeof value === "string" || typeof value === "number") return value;
        throw new Error("Unexpected summary SQL parameter");
      });
      const statement = native.prepare(sql);
      return statement.columns().length > 0
        ? { rows: statement.all(...values) }
        : statement.run(...values);
    },
  };
  let tail = Promise.resolve();
  const database = {
    ...executor,
    transaction<T>(operation: (executor: SqliteExecutor) => Promise<T>): Promise<T> {
      const next = tail.then(async () => {
        native.exec("BEGIN");
        try {
          const result = await operation(executor);
          native.exec("COMMIT");
          return result;
        } catch (cause) {
          native.exec("ROLLBACK");
          throw cause;
        }
      });
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
  return { native, database };
});

// WHY: Node cannot open the Android JSI database. Only replace that native
// connection boundary; all production queries, persistence and projections run on real SQLite.
vi.mock("../src/data/ui-cache-persistence.native", () => ({
  getUiCacheSqliteDatabase: () => sqlite.database,
}));

import { createThreadSummarySqlite } from "../src/data/thread-summary-sqlite.native";
import { createThreadSummaryDatabase } from "../src/data/thread-summary-database.native";

const request: ThreadSummaryViewRequest = {
  viewId: "project",
  connectionId: "server",
  projectCwd: "/repo",
  recentLimit: 2,
  archivedLimit: 2,
  selectedConnectionId: null,
  selectedThreadId: null,
  subagentConnectionId: null,
  subagentLimit: 0,
};

beforeEach(() => sqlite.native.exec("DROP TABLE IF EXISTS codewide_thread_summaries"));

describe("persisted project catalog", () => {
  it("reopens a scoped page and unread membership independently of the global head", async () => {
    const writer = createThreadSummarySqlite();
    await writer.prepare();
    writer.begin();
    for (let i = 0; i < 50; i++)
      writer.write({
        type: "insert",
        value: summary(`other-${i}`, { cwd: "/other", recencyAt: 100 + i }),
      });
    for (const row of [
      summary("old-unread", { unread: 1 }),
      summary("recent", { recencyAt: 3 }),
      summary("second", { recencyAt: 2 }),
      summary("archive", { archived: true }),
    ]) {
      writer.write({ type: "insert", value: row });
    }
    await writer.commit({ durable: true });
    await writer.close();
    const reader = createThreadSummarySqlite();
    const page = await reader.loadView(request);
    expect(page.recent.map((row) => row.name)).toEqual(["recent", "second"]);
    expect(page.archived.map((row) => row.name)).toEqual(["archive"]);
    expect((await reader.loadUnread()).map((row) => row.name)).toEqual(["old-unread"]);
    const allProjectRows = await reader.loadView({ ...request, recentLimit: 36 });
    expect(allProjectRows.recent.map((row) => row.name)).toEqual([
      "recent",
      "second",
      "old-unread",
    ]);
    await reader.close();
  });

  it("project refresh cannot evict another project's rows or discard unread state", async () => {
    const writer = createThreadSummarySqlite();
    await writer.prepare();
    writer.begin();
    for (const row of [
      summary("mine"),
      summary("unread", { unread: 1 }),
      summary("other", { cwd: "/other" }),
    ])
      writer.write({ type: "insert", value: row });
    await writer.commit({ durable: true });
    await writer.close();
    const database = createThreadSummaryDatabase();
    await database.prepare();
    const read = database.beginCatalogRead("server");
    await database.applyCatalogPage("server", [], false, new Set(), read, true, "/repo");
    expect(await database.get("server", "mine")).toBeNull();
    expect((await database.get("server", "other"))?.cwd).toBe("/other");
    expect((await database.get("server", "unread"))?.unread).toBe(1);
    expect(database.projectUnread.projects$.peek()).toEqual(["server\u0000/repo"]);
    await database.markRead("server", "unread");
    expect(database.projectUnread.projects$.peek()).toEqual([]);
    read.release();
    await database.close();
  });
});
