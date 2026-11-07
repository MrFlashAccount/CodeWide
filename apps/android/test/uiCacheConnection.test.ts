import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wrapSqliteDatabase } from "@codewide/tanstack-db-sqlite";
import { appLogger } from "../src/observability/logger";
import {
  createRecoverableUiCacheConnection,
  type UiCacheNativeConnection,
} from "../src/data/uiCacheConnection";
import {
  closeHarness,
  createHarness,
  readFileRows,
  type Executor,
  type Harness,
} from "./uiCacheDatabase.fixture";

async function seed(harness: Harness) {
  const database = wrapSqliteDatabase(createRecoverableUiCacheConnection(harness.ports));
  await database.transaction(async (executor) => {
    await executor.execute("CREATE TABLE drafts (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    await executor.execute(
      "CREATE TABLE draft_meta (singleton INTEGER PRIMARY KEY, count INTEGER)",
    );
    await executor.execute("INSERT INTO draft_meta VALUES (1, 0)");
    await executor.execute(
      "CREATE TRIGGER drafts_count AFTER INSERT ON drafts BEGIN " +
        "UPDATE draft_meta SET count = count + 1 WHERE singleton = 1; END",
    );
    await executor.execute("INSERT INTO drafts VALUES (?, ?)", ["before", "cached"]);
  });
  return database;
}

describe("recoverable UI cache connection", () => {
  let root: string;
  let harness: Harness;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ui-cache-connection-"));
    harness = createHarness(root);
  });

  afterEach(() => {
    closeHarness(harness);
    rmSync(root, { force: true, recursive: true });
    vi.restoreAllMocks();
  });

  it("restores a removed database file and retries the failed write on the new connection", async () => {
    const warn = vi.spyOn(appLogger, "warnCaught");
    const database = await seed(harness);

    harness.removeCacheDirectory();
    await database.execute("INSERT INTO drafts VALUES (?, ?)", ["after", "written"]);

    expect(existsSync(harness.databasePath)).toBe(true);
    expect(harness.connections).toHaveLength(2);
    expect(harness.connections[0]?.closed).toBe(true);
    // The consumer's wrapper now reads from the replacement connection.
    await expect(database.execute("SELECT id FROM drafts ORDER BY id")).resolves.toEqual({
      rows: [{ id: "after" }, { id: "before" }],
    });
    // Schema, triggers and cached rows survive on disk, so memoized consumer
    // schema preparation and in-memory mirrors stay valid.
    expect(readFileRows(harness.databasePath, "SELECT count FROM draft_meta")).toEqual([
      { count: 2 },
    ]);
    const recovered = warn.mock.calls.find(
      ([input]) => input.event === "ui_cache.database_reopened",
    );
    expect(recovered?.[0].error).toBeInstanceOf(Error);
    expect((recovered?.[0].error as Error).message).toContain(
      "attempt to write a readonly database",
    );
  });

  it("retries a failed transaction once on the restored connection", async () => {
    const database = await seed(harness);
    harness.removeCacheDirectory();

    const operation = vi.fn(async (executor: Executor) => {
      await executor.execute("INSERT INTO drafts VALUES (?, ?)", ["tx", "written"]);
    });
    await database.transaction(operation);

    expect(operation).toHaveBeenCalledTimes(2);
    expect(readFileRows(harness.databasePath, "SELECT id FROM drafts ORDER BY id")).toEqual([
      { id: "before" },
      { id: "tx" },
    ]);
  });

  it("recovers concurrent failed writes with one reopen", async () => {
    const database = await seed(harness);
    harness.removeCacheDirectory();

    await Promise.all(
      ["a", "b", "c"].map(async (id) =>
        database.execute("INSERT INTO drafts VALUES (?, ?)", [id, id]),
      ),
    );

    expect(harness.connections).toHaveLength(2);
    expect(readFileRows(harness.databasePath, "SELECT id FROM drafts ORDER BY id")).toEqual([
      { id: "a" },
      { id: "b" },
      { id: "before" },
      { id: "c" },
    ]);
  });

  it("waits for operations in flight on the stale connection before closing it", async () => {
    const database = await seed(harness);
    const stale = harness.connections[0];
    if (stale === undefined) throw new Error("missing initial connection");
    const releaseRead = stale.holdNext("SELECT value FROM drafts WHERE id = 'before'");
    const read = database.execute("SELECT value FROM drafts WHERE id = 'before'");
    harness.removeCacheDirectory();

    const write = database.execute("INSERT INTO drafts VALUES (?, ?)", ["after", "written"]);
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    // Recovery is parked on the in-flight read: no copy, swap or close yet.
    expect(existsSync(dirname(harness.databasePath))).toBe(false);
    expect(harness.connections).toHaveLength(1);
    expect(stale.closed).toBe(false);

    releaseRead();
    await expect(read).resolves.toEqual({ rows: [{ value: "cached" }] });
    await write;
    expect(stale.closed).toBe(true);
    expect(readFileRows(harness.databasePath, "SELECT id FROM drafts ORDER BY id")).toEqual([
      { id: "after" },
      { id: "before" },
    ]);
  });

  it("starts an empty cache when the removed database cannot be copied", async () => {
    const failure = vi.spyOn(appLogger, "errorCaught");
    const database = await seed(harness);
    harness.removeCacheDirectory();
    const ports = harness.ports;
    vi.spyOn(ports, "prepareRestoreTarget").mockRejectedValueOnce(new Error("copy refused"));

    await database.execute("CREATE TABLE IF NOT EXISTS fresh (id TEXT PRIMARY KEY)");

    expect(harness.connections).toHaveLength(2);
    expect(readFileRows(harness.databasePath, "SELECT name FROM sqlite_master")).toEqual([
      { name: "fresh" },
      { name: "sqlite_autoindex_fresh_1" },
    ]);
    expect(failure.mock.calls.map(([input]) => input.event)).toContain("ui_cache.restore_failed");
  });

  it("does not reopen for errors unrelated to a removed file", async () => {
    const database = await seed(harness);

    await expect(
      database.execute("INSERT INTO drafts VALUES (?, ?)", ["before", "dup"]),
    ).rejects.toThrow(/UNIQUE constraint failed/);
    expect(harness.connections).toHaveLength(1);
  });

  it("rethrows a readonly failure while the database file is still in place", async () => {
    const readonly = new Error(
      "[op-sqlite] statement execution error: attempt to write a readonly database",
    );
    const open = vi.fn((): UiCacheNativeConnection => ({
      close: () => undefined,
      execute: async () => {
        throw readonly;
      },
      transaction: async () => undefined,
    }));
    const connection = createRecoverableUiCacheConnection({
      ...harness.ports,
      databaseFileExists: async () => true,
      open,
    });

    await expect(connection.execute("INSERT INTO drafts VALUES ('x', 'y')")).rejects.toBe(readonly);
    expect(open).toHaveBeenCalledTimes(1);
  });
});
