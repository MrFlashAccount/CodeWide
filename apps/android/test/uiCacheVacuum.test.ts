import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appLogger } from "../src/observability/logger";
import {
  createRecoverableUiCacheConnection,
  type RecoverableUiCacheConnection,
} from "../src/data/uiCacheConnection";
import { createUiCacheVacuum } from "../src/data/uiCacheVacuum";
import { closeHarness, createHarness, readFileRows, type Harness } from "./uiCacheDatabase.fixture";

const ROWS = 3000;

function pragma(path: string, name: string): unknown {
  return readFileRows(path, `PRAGMA ${name}`)[0];
}

/** Writes rows large enough that deleting them frees several reclaim steps of pages. */
async function fillDrafts(connection: RecoverableUiCacheConnection): Promise<void> {
  await connection.transaction(async (executor) => {
    await executor.execute(
      "CREATE TABLE IF NOT EXISTS drafts (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
    );
    for (let id = 0; id < ROWS; id += 1) {
      await executor.execute("INSERT INTO drafts VALUES (?, ?)", [id, `${id}:${"x".repeat(3000)}`]);
    }
  });
}

/** Simulates FIFO eviction: deletes the oldest rows and keeps the newest tenth. */
async function evictOldest(connection: RecoverableUiCacheConnection): Promise<void> {
  await connection.execute("DELETE FROM drafts WHERE id < ?", [ROWS - ROWS / 10]);
}

/** Creates a populated database the way builds before auto-vacuum did. */
function createLegacyDatabase(path: string): void {
  const legacy = new DatabaseSync(path);
  try {
    legacy.exec("CREATE TABLE drafts (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    const insert = legacy.prepare("INSERT INTO drafts VALUES (?, ?)");
    legacy.exec("BEGIN");
    for (let id = 0; id < ROWS; id += 1) {
      insert.run(id, `${id}:${"x".repeat(3000)}`);
    }
    legacy.exec("COMMIT");
    legacy.exec(`DELETE FROM drafts WHERE id < ${ROWS / 2}`);
  } finally {
    legacy.close();
  }
}

function draftIds(path: string): unknown[] {
  return readFileRows(path, "SELECT id FROM drafts ORDER BY id").map((row) =>
    Object.values(row as Record<string, unknown>).at(0),
  );
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, index) => from + index);
}

describe("UI cache vacuum", () => {
  let root: string;
  let harness: Harness;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ui-cache-vacuum-"));
    harness = createHarness(root);
  });

  afterEach(() => {
    closeHarness(harness);
    rmSync(root, { force: true, recursive: true });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("creates a new database in incremental auto-vacuum mode before its first table", async () => {
    const info = vi.spyOn(appLogger, "info");
    const connection = createRecoverableUiCacheConnection(harness.ports);

    await connection.execute("CREATE TABLE drafts (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    await createUiCacheVacuum(connection).migrateAtIdle();

    expect(pragma(harness.databasePath, "auto_vacuum")).toEqual({ auto_vacuum: 2 });
    expect(info).not.toHaveBeenCalled();
  });

  it("migrates an existing database without auto-vacuum once, keeping its rows", async () => {
    createLegacyDatabase(harness.databasePath);
    const sizeBefore = statSync(harness.databasePath).size;
    const info = vi.spyOn(appLogger, "info");
    const connection = createRecoverableUiCacheConnection(harness.ports);
    const vacuum = createUiCacheVacuum(connection);
    // Opening an existing file cannot change its mode without a full VACUUM.
    expect(pragma(harness.databasePath, "auto_vacuum")).toEqual({ auto_vacuum: 0 });

    await vacuum.migrateAtIdle();
    await vacuum.migrateAtIdle();

    expect(pragma(harness.databasePath, "auto_vacuum")).toEqual({ auto_vacuum: 2 });
    expect(draftIds(harness.databasePath)).toEqual(range(ROWS / 2, ROWS));
    // The full VACUUM also drops the free pages the legacy file had accumulated.
    expect(pragma(harness.databasePath, "freelist_count")).toEqual({ freelist_count: 0 });
    expect(statSync(harness.databasePath).size).toBeLessThan(sizeBefore);
    expect(info.mock.calls.map(([input]) => input.event)).toEqual([
      "ui_cache.auto_vacuum_migrated",
    ]);
  });

  it("runs the migration only after admitted operations settle and holds later ones", async () => {
    createLegacyDatabase(harness.databasePath);
    const connection = createRecoverableUiCacheConnection(harness.ports);
    const vacuum = createUiCacheVacuum(connection);
    const native = harness.connections[0];
    if (native === undefined) throw new Error("missing connection");
    const releaseRead = native.holdNext("SELECT COUNT(*) AS n FROM drafts");
    const read = connection.execute("SELECT COUNT(*) AS n FROM drafts");

    const migration = vacuum.migrateAtIdle();
    const write = connection.execute("INSERT INTO drafts VALUES (?, ?)", [ROWS, "after"]);
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    // VACUUM fails inside an open statement or transaction, so it waits.
    expect(pragma(harness.databasePath, "auto_vacuum")).toEqual({ auto_vacuum: 0 });
    expect(readFileRows(harness.databasePath, `SELECT id FROM drafts WHERE id = ${ROWS}`)).toEqual(
      [],
    );

    releaseRead();
    await expect(read).resolves.toEqual({ rows: [{ n: ROWS / 2 }] });
    await migration;
    await write;
    expect(pragma(harness.databasePath, "auto_vacuum")).toEqual({ auto_vacuum: 2 });
    expect(draftIds(harness.databasePath).at(-1)).toBe(ROWS);
  });

  it("leaves the migration for the next idle point when operations do not settle", async () => {
    createLegacyDatabase(harness.databasePath);
    const connection = createRecoverableUiCacheConnection(harness.ports);
    const vacuum = createUiCacheVacuum(connection);
    const native = harness.connections[0];
    if (native === undefined) throw new Error("missing connection");
    const releaseRead = native.holdNext("SELECT COUNT(*) AS n FROM drafts");
    const read = connection.execute("SELECT COUNT(*) AS n FROM drafts");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const busy = vacuum.migrateAtIdle();
    await vi.advanceTimersByTimeAsync(5000);
    await busy;
    vi.useRealTimers();
    // Later operations are admitted again while the stuck one still runs.
    await connection.execute("INSERT INTO drafts VALUES (?, ?)", [ROWS, "after"]);
    expect(pragma(harness.databasePath, "auto_vacuum")).toEqual({ auto_vacuum: 0 });

    releaseRead();
    await read;
    await vacuum.migrateAtIdle();
    expect(pragma(harness.databasePath, "auto_vacuum")).toEqual({ auto_vacuum: 2 });
    expect(draftIds(harness.databasePath).at(-1)).toBe(ROWS);
  });

  it("returns pages freed by eviction to the filesystem", async () => {
    const connection = createRecoverableUiCacheConnection(harness.ports);
    const vacuum = createUiCacheVacuum(connection);
    await fillDrafts(connection);
    const fullSize = statSync(harness.databasePath).size;
    await evictOldest(connection);
    const evicted = readFileRows(harness.databasePath, "PRAGMA freelist_count")[0];
    // Without reclaim the deleted pages stay in the file as free pages.
    expect(statSync(harness.databasePath).size).toBe(fullSize);
    expect(evicted).not.toEqual({ freelist_count: 0 });

    await vacuum.reclaimFreePages();

    expect(pragma(harness.databasePath, "freelist_count")).toEqual({ freelist_count: 0 });
    expect(statSync(harness.databasePath).size).toBeLessThan(fullSize / 5);
    expect(draftIds(harness.databasePath)).toEqual(range(ROWS - ROWS / 10, ROWS));
  });

  it("stops reclaiming on a database still awaiting migration", async () => {
    createLegacyDatabase(harness.databasePath);
    const free = pragma(harness.databasePath, "freelist_count");
    const connection = createRecoverableUiCacheConnection(harness.ports);

    await createUiCacheVacuum(connection).reclaimFreePages();

    expect(pragma(harness.databasePath, "freelist_count")).toEqual(free);
    expect(free).not.toEqual({ freelist_count: 0 });
  });

  it("keeps incremental auto-vacuum on a database restored after the cache file is removed", async () => {
    const connection = createRecoverableUiCacheConnection(harness.ports);
    const vacuum = createUiCacheVacuum(connection);
    await fillDrafts(connection);

    harness.removeCacheDirectory();
    await evictOldest(connection);

    expect(harness.connections).toHaveLength(2);
    expect(pragma(harness.databasePath, "auto_vacuum")).toEqual({ auto_vacuum: 2 });
    const restoredSize = statSync(harness.databasePath).size;
    await vacuum.reclaimFreePages();
    expect(statSync(harness.databasePath).size).toBeLessThan(restoredSize / 5);
    expect(draftIds(harness.databasePath)).toEqual(range(ROWS - ROWS / 10, ROWS));
  });
});
