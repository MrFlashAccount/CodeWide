import { DatabaseSync } from "node:sqlite";
import { createCollection, IR, type LoadSubsetOptions } from "@tanstack/db";
import { afterEach, describe, expect, it } from "vitest";

import {
  createSqliteSyncRuntime,
  type SqliteDatabase,
  type SqliteExecutor,
  type SqliteValue,
} from "../src";

type Row = {
  id: string;
  groupId: string;
  ordinal: number;
  sealed: boolean;
  tag?: string | null;
};

const databases: DatabaseSync[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

function createDatabase(recordedSelects: string[] = []): SqliteDatabase {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  const executor = {
    async execute(sql: string, params: readonly SqliteValue[] = []) {
      const statement = database.prepare(sql);
      if (/^\s*(?:SELECT|PRAGMA|WITH)\b/i.test(sql)) {
        recordedSelects.push(sql);
        return { rows: statement.all(...params as never[]) as Record<string, SqliteValue>[] };
      }
      statement.run(...params as never[]);
      return { rows: [] };
    },
  };
  return {
    ...executor,
    async transaction<T>(operation: (tx: typeof executor) => Promise<T>): Promise<T> {
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = await operation(executor);
        database.exec("COMMIT");
        return result;
      } catch (cause) {
        database.exec("ROLLBACK");
        throw cause;
      }
    },
  };
}

function createRuntime(database: SqliteDatabase) {
  return createSqliteSyncRuntime<Row, string>({
    id: "test-rows",
    tableName: "test_rows",
    schemaVersion: 1,
    database,
    getKey: (row) => row.id,
    columns: [
      { property: "groupId", column: "group_id", type: "TEXT" },
      { property: "ordinal", column: "ordinal", type: "INTEGER" },
      { property: "sealed", column: "sealed", type: "INTEGER", encode: (value) => value ? 1 : 0 },
      { property: "tag", column: "tag", type: "TEXT", nullable: true },
    ],
    indexes: [["groupId", "sealed", "ordinal"]],
    checkpointDelayMs: 1,
  });
}

async function seed(runtime: ReturnType<typeof createRuntime>, rows: readonly Row[]): Promise<void> {
  runtime.begin();
  for (const row of rows) runtime.write({ type: "insert", value: row });
  await runtime.commit({ durable: true });
}

describe("SQLite-backed TanStack sync runtime", () => {
  it("hydrates eager collections before ready and persists direct mutations", async () => {
    const database = createDatabase();
    const seedRuntime = createRuntime(database);
    const seedCollection = createCollection({ id: "eager-seed", getKey: (row: Row) => row.id, syncMode: "on-demand", sync: seedRuntime.sync });
    seedCollection.startSyncImmediate();
    await seed(seedRuntime, [{ id: "row-1", groupId: "a", ordinal: 1, sealed: true, tag: null }]);
    await seedRuntime.close();
    seedCollection.cleanup();

    const runtime = createSqliteSyncRuntime<Row, string>({
      id: "test-rows",
      tableName: "test_rows",
      schemaVersion: 1,
      database,
      getKey: (row) => row.id,
      columns: [
        { property: "groupId", column: "group_id", type: "TEXT" },
        { property: "ordinal", column: "ordinal", type: "INTEGER" },
        { property: "sealed", column: "sealed", type: "INTEGER", encode: (value) => value ? 1 : 0 },
        { property: "tag", column: "tag", type: "TEXT", nullable: true },
      ],
      initialSync: "all",
      checkpointDelayMs: 1,
    });
    const collection = createCollection({
      id: "eager-runtime",
      getKey: (row: Row) => row.id,
      syncMode: "eager",
      sync: runtime.sync,
      ...runtime.mutations,
    });

    await collection.preload();
    expect(collection.toArray.map(({ id }) => id)).toEqual(["row-1"]);
    const transaction = collection.insert({ id: "row-2", groupId: "b", ordinal: 2, sealed: true, tag: null });
    await transaction.isPersisted.promise;
    expect((await runtime.query({})).map(({ id }) => id).sort()).toEqual(["row-1", "row-2"]);
    const update = collection.update("row-2", (draft) => { draft.ordinal = 3; });
    await update.isPersisted.promise;
    expect((await runtime.query({})).find(({ id }) => id === "row-2")?.ordinal).toBe(3);
    const deletion = collection.delete("row-1");
    await deletion.isPersisted.promise;
    expect((await runtime.query({})).map(({ id }) => id)).toEqual(["row-2"]);

    await runtime.close();
    collection.cleanup();
  });

  it("keeps an eager collection mutation pending until its failed checkpoint becomes durable", async () => {
    const base = createDatabase();
    let failWrites = false;
    let observeFailure!: () => void;
    const failureObserved = new Promise<void>((resolve) => { observeFailure = resolve; });
    const database: SqliteDatabase = {
      execute: base.execute,
      async transaction<T>(operation: (executor: SqliteExecutor) => Promise<T>) {
        if (failWrites) throw new Error("disk unavailable");
        return await base.transaction(operation);
      },
    };
    const runtime = createSqliteSyncRuntime<Row, string>({
      id: "eager-mutation-retry",
      tableName: "eager_mutation_retry_rows",
      schemaVersion: 1,
      database,
      getKey: (row) => row.id,
      columns: [{ property: "ordinal", column: "ordinal", type: "INTEGER" }],
      initialSync: "all",
      checkpointRetry: { maxAttempts: 1 },
      subsetRetry: { baseDelayMs: 10, maxDelayMs: 10 },
      onBackgroundError: () => observeFailure(),
    });
    const collection = createCollection({
      id: "eager-mutation-retry",
      getKey: (row: Row) => row.id,
      syncMode: "eager",
      sync: runtime.sync,
      ...runtime.mutations,
    });
    await collection.preload();
    failWrites = true;

    const transaction = collection.insert({ id: "row", groupId: "a", ordinal: 1, sealed: true });
    let persisted = false;
    void transaction.isPersisted.promise.then(() => { persisted = true; });
    await failureObserved;
    expect(persisted).toBe(false);
    expect(collection.get("row")?.ordinal).toBe(1);

    failWrites = false;
    await transaction.isPersisted.promise;
    expect((await runtime.query({})).map(({ id }) => id)).toEqual(["row"]);

    await runtime.close();
    collection.cleanup();
  });

  it("runs bootstrap exactly once before the first resident snapshot", async () => {
    const database = createDatabase();
    let bootstrapCalls = 0;
    const createBootstrappedRuntime = () => createSqliteSyncRuntime<Row, string>({
      id: "bootstrapped-rows",
      tableName: "bootstrapped_rows",
      schemaVersion: 1,
      database,
      getKey: (row) => row.id,
      columns: [
        { property: "groupId", column: "group_id", type: "TEXT" },
        { property: "ordinal", column: "ordinal", type: "INTEGER" },
        { property: "sealed", column: "sealed", type: "INTEGER", encode: (value) => value ? 1 : 0 },
        { property: "tag", column: "tag", type: "TEXT", nullable: true },
      ],
      initialSync: "all",
      bootstrap: {
        id: "legacy-v1",
        load: async () => {
          bootstrapCalls += 1;
          return [{ id: "legacy", groupId: "a", ordinal: 1, sealed: true, tag: null }];
        },
      },
    });

    const firstRuntime = createBootstrappedRuntime();
    const firstCollection = createCollection({ id: "bootstrap-first", getKey: (row: Row) => row.id, syncMode: "eager", sync: firstRuntime.sync });
    await firstCollection.preload();
    expect(firstCollection.toArray.map(({ id }) => id)).toEqual(["legacy"]);
    await firstRuntime.close();
    firstCollection.cleanup();

    await database.execute("DELETE FROM bootstrapped_rows");
    const secondRuntime = createBootstrappedRuntime();
    const secondCollection = createCollection({ id: "bootstrap-second", getKey: (row: Row) => row.id, syncMode: "eager", sync: secondRuntime.sync });
    await secondCollection.preload();
    expect(secondCollection.toArray).toEqual([]);
    expect(bootstrapCalls).toBe(1);
    await secondRuntime.close();
    secondCollection.cleanup();
  });

  it("pushes filtering, ordering and pagination into SQLite", async () => {
    const selects: string[] = [];
    const runtime = createRuntime(createDatabase(selects));
    const collection = createCollection({ id: "sql-pushdown", getKey: (row: Row) => row.id, syncMode: "on-demand", sync: runtime.sync });
    collection.startSyncImmediate();
    await runtime.prepare();
    await seed(runtime, Array.from({ length: 100 }, (_, ordinal) => ({
      id: `row-${ordinal}`,
      groupId: ordinal % 2 === 0 ? "a" : "b",
      ordinal,
      sealed: true,
      tag: null,
    })));

    const rows = await runtime.query({
      where: new IR.Func("eq", [new IR.PropRef(["groupId"]), new IR.Value("a")]),
      orderBy: [{
        expression: new IR.PropRef(["ordinal"]),
        compareOptions: { direction: "desc", nulls: "last" },
      }],
      limit: 5,
      offset: 3,
    });

    expect(rows.map(({ ordinal }) => ordinal)).toEqual([92, 90, 88, 86, 84]);
    expect(selects.at(-1)).toMatch(/WHERE .*group_id.* ORDER BY .*ordinal.* LIMIT \? OFFSET \?/);
    await runtime.close();
    collection.cleanup();
  });

  it("keeps the hot collection equal to the active subset union", async () => {
    const runtime = createRuntime(createDatabase());
    const collection = createCollection({ id: "resident-union", getKey: (row: Row) => row.id, syncMode: "on-demand", sync: runtime.sync });
    collection.startSyncImmediate();
    await seed(runtime, Array.from({ length: 12 }, (_, ordinal) => ({
      id: `row-${ordinal}`,
      groupId: "a",
      ordinal,
      sealed: true,
      tag: null,
    })));
    const first = {
      orderBy: [{ expression: new IR.PropRef(["ordinal"]), compareOptions: { direction: "desc", nulls: "last" } }],
      limit: 4,
    } satisfies LoadSubsetOptions;
    const second = {
      where: new IR.Func("lte", [new IR.PropRef(["ordinal"]), new IR.Value(7)]),
      orderBy: [{ expression: new IR.PropRef(["ordinal"]), compareOptions: { direction: "desc", nulls: "last" } }],
      limit: 4,
    } satisfies LoadSubsetOptions;

    await collection._sync.loadSubset(first);
    expect(collection.toArray.map(({ ordinal }) => ordinal).sort((a, b) => b - a)).toEqual([11, 10, 9, 8]);
    await collection._sync.loadSubset(second);
    expect(collection.toArray.map(({ ordinal }) => ordinal).sort((a, b) => b - a)).toEqual([11, 10, 9, 8, 7, 6, 5, 4]);

    collection._sync.unloadSubset(first);
    await Promise.resolve();
    expect(collection.toArray.map(({ ordinal }) => ordinal).sort((a, b) => b - a)).toEqual([7, 6, 5, 4]);
    await runtime.close();
    collection.cleanup();
  });

  it("keeps independently requested pages from the same subscription resident", async () => {
    const runtime = createRuntime(createDatabase());
    const collection = createCollection({ id: "resident-pages", getKey: (row: Row) => row.id, syncMode: "on-demand", sync: runtime.sync });
    collection.startSyncImmediate();
    await seed(runtime, Array.from({ length: 8 }, (_, ordinal) => ({
      id: `row-${ordinal}`,
      groupId: "a",
      ordinal,
      sealed: true,
      tag: null,
    })));
    const subscription = {} as NonNullable<LoadSubsetOptions["subscription"]>;
    const newest = {
      orderBy: [{ expression: new IR.PropRef(["ordinal"]), compareOptions: { direction: "desc", nulls: "last" } }],
      limit: 4,
      subscription,
    } satisfies LoadSubsetOptions;
    const older = {
      where: new IR.Func("lte", [new IR.PropRef(["ordinal"]), new IR.Value(3)]),
      orderBy: [{ expression: new IR.PropRef(["ordinal"]), compareOptions: { direction: "desc", nulls: "last" } }],
      limit: 4,
      subscription,
    } satisfies LoadSubsetOptions;

    await collection._sync.loadSubset(newest);
    await collection._sync.loadSubset(older);
    expect(collection.toArray.map(({ ordinal }) => ordinal).sort((a, b) => b - a)).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);

    collection._sync.unloadSubset(older);
    await Promise.resolve();
    expect(collection.toArray.map(({ ordinal }) => ordinal).sort((a, b) => b - a)).toEqual([7, 6, 5, 4]);
    await runtime.close();
    collection.cleanup();
  });

  it("uses the column encoder for query values", async () => {
    const runtime = createRuntime(createDatabase());
    const collection = createCollection({ id: "encoded-filter", getKey: (row: Row) => row.id, syncMode: "on-demand", sync: runtime.sync });
    collection.startSyncImmediate();
    await seed(runtime, [
      { id: "open", groupId: "a", ordinal: 1, sealed: false, tag: null },
      { id: "closed", groupId: "a", ordinal: 2, sealed: true, tag: null },
    ]);

    const rows = await runtime.query({
      where: new IR.Func("eq", [new IR.PropRef(["sealed"]), new IR.Value(false)]),
    });

    expect(rows.map(({ id }) => id)).toEqual(["open"]);
    await runtime.close();
    collection.cleanup();
  });

  it("uses the encoded representation for hot predicate membership", async () => {
    const runtime = createSqliteSyncRuntime<Row, string>({
      id: "encoded-hot-membership",
      tableName: "encoded_hot_rows",
      schemaVersion: 1,
      database: createDatabase(),
      getKey: (row) => row.id,
      columns: [{
        property: "tag",
        column: "tag",
        type: "TEXT",
        encode: (value) => typeof value === "string" ? value.toLowerCase() : value ?? null,
      }],
    });
    const collection = createCollection({ id: "encoded-hot-membership", getKey: (row: Row) => row.id, syncMode: "on-demand", sync: runtime.sync });
    collection.startSyncImmediate();
    await seed(runtime, [{ id: "first", groupId: "a", ordinal: 1, sealed: true, tag: "Apple" }]);
    const apples = {
      where: new IR.Func("eq", [new IR.PropRef(["tag"]), new IR.Value("apple")]),
    } satisfies LoadSubsetOptions;
    await collection._sync.loadSubset(apples);
    expect(collection.toArray.map(({ id }) => id)).toEqual(["first"]);

    runtime.begin();
    runtime.write({
      type: "insert",
      value: { id: "second", groupId: "a", ordinal: 2, sealed: true, tag: "APPLE" },
    });
    await runtime.commit({ durable: true });
    expect(collection.toArray.map(({ id }) => id).sort()).toEqual(["first", "second"]);

    await collection._sync.loadSubset(apples);
    expect(collection.toArray.map(({ id }) => id).sort()).toEqual(["first", "second"]);
    await runtime.close();
    collection.cleanup();
  });

  it("rejects encoders that violate the declared SQLite storage class", async () => {
    const numericRuntime = createSqliteSyncRuntime<Row, string>({
      id: "invalid-numeric-encoder",
      tableName: "invalid_numeric_encoder_rows",
      schemaVersion: 1,
      database: createDatabase(),
      getKey: (row) => row.id,
      columns: [{ property: "ordinal", column: "ordinal", type: "INTEGER", encode: () => "1" }],
    });
    numericRuntime.begin();
    expect(() => numericRuntime.write({
      type: "insert",
      value: { id: "numeric", groupId: "a", ordinal: 1, sealed: true },
    })).toThrow("must return a finite number");

    const binaryRuntime = createSqliteSyncRuntime<Row, string>({
      id: "invalid-binary-encoder",
      tableName: "invalid_binary_encoder_rows",
      schemaVersion: 1,
      database: createDatabase(),
      getKey: (row) => row.id,
      columns: [{ property: "tag", column: "tag", type: "TEXT", encode: () => new Uint8Array([1, 2]) }],
    });
    binaryRuntime.begin();
    expect(() => binaryRuntime.write({
      type: "insert",
      value: { id: "binary", groupId: "a", ordinal: 1, sealed: true, tag: "value" },
    })).toThrow("must return string or null");

    await numericRuntime.close();
    await binaryRuntime.close();
  });

  it("keeps SQL three-valued predicate membership stable before and after reload", async () => {
    const runtime = createRuntime(createDatabase());
    const collection = createCollection({ id: "nullish-filter", getKey: (row: Row) => row.id, syncMode: "on-demand", sync: runtime.sync });
    collection.startSyncImmediate();
    await seed(runtime, [
      { id: "null", groupId: "a", ordinal: 1, sealed: true, tag: null },
      { id: "excluded", groupId: "a", ordinal: 2, sealed: true, tag: "x" },
      { id: "present", groupId: "a", ordinal: 3, sealed: true, tag: "value" },
    ]);
    const notExcluded = {
      where: new IR.Func("not", [
        new IR.Func("eq", [new IR.PropRef(["tag"]), new IR.Value("x")]),
      ]),
    } satisfies LoadSubsetOptions;
    await collection._sync.loadSubset(notExcluded);
    expect(collection.toArray.map(({ id }) => id).sort()).toEqual(["present"]);

    runtime.begin();
    runtime.write({ type: "insert", value: { id: "later-null", groupId: "a", ordinal: 4, sealed: true, tag: null } });
    await runtime.commit({ durable: true });
    // A new write remains briefly resident for optimistic consumers, but it
    // must not become a member of the active SQL subset.
    expect(collection.toArray.map(({ id }) => id).sort()).toEqual(["later-null", "present"]);
    await collection._sync.loadSubset(notExcluded);
    expect(collection.toArray.map(({ id }) => id).sort()).toEqual(["present"]);
    expect((await runtime.query(notExcluded)).map(({ id }) => id)).toEqual(["present"]);
    expect((await runtime.query({
      where: new IR.Func("isNull", [new IR.PropRef(["tag"])]),
    })).map(({ id }) => id).sort()).toEqual(["later-null", "null"]);
    await expect(runtime.query({
      where: new IR.Func("isUndefined", [new IR.PropRef(["tag"])]),
    })).rejects.toThrow("explicit null");
    await expect(runtime.query({
      where: new IR.Func("in", [new IR.PropRef(["tag"]), new IR.Value([null, "value"])]),
    })).rejects.toThrow("does not support nullish values");

    runtime.begin();
    expect(() => runtime.write({
      type: "insert",
      value: { id: "missing", groupId: "a", ordinal: 5, sealed: true },
    })).toThrow("explicit null");
    await runtime.close();
    collection.cleanup();
  });

  it("rejects text operations whose SQLite collation differs from TanStack DB", async () => {
    const runtime = createRuntime(createDatabase());
    const collection = createCollection({ id: "text-collation", getKey: (row: Row) => row.id, syncMode: "on-demand", sync: runtime.sync });
    collection.startSyncImmediate();
    await seed(runtime, [
      { id: "ascii", groupId: "a", ordinal: 1, sealed: true, tag: "Apple" },
      { id: "unicode", groupId: "a", ordinal: 2, sealed: true, tag: "ä" },
    ]);

    const unsupportedLike = {
      where: new IR.Func("like", [new IR.PropRef(["tag"]), new IR.Value("a%")]),
    } satisfies LoadSubsetOptions;
    expect(() => collection._sync.loadSubset(unsupportedLike)).toThrow("case sensitivity differs");
    await expect(runtime.query({
      where: new IR.Func("lt", [new IR.PropRef(["tag"]), new IR.Value("z")]),
    })).rejects.toThrow("collation differs");
    await expect(runtime.query({
      orderBy: [{
        expression: new IR.PropRef(["tag"]),
        compareOptions: { direction: "asc", nulls: "last" },
      }],
      limit: 1,
    })).rejects.toThrow("collation differs");

    const supported = {
      where: new IR.Func("eq", [new IR.PropRef(["tag"]), new IR.Value("Apple")]),
    } satisfies LoadSubsetOptions;
    await collection._sync.loadSubset(supported);
    runtime.begin();
    runtime.write({
      type: "insert",
      value: { id: "later", groupId: "a", ordinal: 3, sealed: true, tag: "Apple" },
    });
    await expect(runtime.commit({ durable: true })).resolves.toBeUndefined();
    expect(collection.toArray.map(({ id }) => id).sort()).toEqual(["ascii", "later"]);

    await runtime.close();
    collection.cleanup();
  });

  it("reloads a bounded page when an update changes its ordering", async () => {
    const runtime = createRuntime(createDatabase());
    const collection = createCollection({ id: "ordered-update", getKey: (row: Row) => row.id, syncMode: "on-demand", sync: runtime.sync });
    collection.startSyncImmediate();
    await seed(runtime, Array.from({ length: 5 }, (_, ordinal) => ({
      id: `row-${ordinal}`,
      groupId: "a",
      ordinal,
      sealed: true,
      tag: null,
    })));
    const newest = {
      orderBy: [{ expression: new IR.PropRef(["ordinal"]), compareOptions: { direction: "desc", nulls: "last" } }],
      limit: 2,
    } satisfies LoadSubsetOptions;
    await collection._sync.loadSubset(newest);

    runtime.begin();
    runtime.write({ type: "update", value: { id: "row-4", groupId: "a", ordinal: 0, sealed: true, tag: null } });
    await runtime.commit({ durable: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(collection.toArray.map(({ id }) => id).sort()).toEqual(["row-2", "row-3"]);
    await runtime.close();
    collection.cleanup();
  });

  it("retries a failed bounded-page refresh before resolving the durable commit", async () => {
    const base = createDatabase();
    let failRefresh = false;
    let holdRecovery = false;
    let signalFailure!: () => void;
    let signalRecoveryStarted!: () => void;
    let releaseRecovery!: () => void;
    const failureObserved = new Promise<void>((resolve) => { signalFailure = resolve; });
    const recoveryStarted = new Promise<void>((resolve) => { signalRecoveryStarted = resolve; });
    const recoveryGate = new Promise<void>((resolve) => { releaseRecovery = resolve; });
    const database: SqliteDatabase = {
      async execute(sql, params) {
        if (/^SELECT "__payload"/.test(sql) && failRefresh) {
          failRefresh = false;
          throw new Error("refresh read failed");
        }
        const result = await base.execute(sql, params);
        if (/^SELECT "__payload"/.test(sql) && holdRecovery) {
          holdRecovery = false;
          signalRecoveryStarted();
          await recoveryGate;
        }
        return result;
      },
      transaction: base.transaction,
    };
    const runtime = createSqliteSyncRuntime<Row, string>({
      id: "bounded-refresh-retry",
      tableName: "bounded_refresh_retry_rows",
      schemaVersion: 1,
      database,
      getKey: (row) => row.id,
      columns: [{ property: "ordinal", column: "ordinal", type: "INTEGER" }],
      subsetRetry: { baseDelayMs: 1, maxDelayMs: 1 },
      onBackgroundError: () => signalFailure(),
    });
    const collection = createCollection({ id: "bounded-refresh-retry", getKey: (row: Row) => row.id, syncMode: "on-demand", sync: runtime.sync });
    collection.startSyncImmediate();
    await seed(runtime, Array.from({ length: 5 }, (_, ordinal) => ({
      id: `row-${ordinal}`,
      groupId: "a",
      ordinal,
      sealed: true,
    })));
    const newest = {
      orderBy: [{ expression: new IR.PropRef(["ordinal"]), compareOptions: { direction: "desc", nulls: "last" } }],
      limit: 2,
    } satisfies LoadSubsetOptions;
    await collection._sync.loadSubset(newest);
    expect(collection.toArray.map(({ id }) => id).sort()).toEqual(["row-3", "row-4"]);

    failRefresh = true;
    holdRecovery = true;
    runtime.begin();
    runtime.write({ type: "update", value: { id: "row-4", groupId: "a", ordinal: 0, sealed: true } });
    const committing = runtime.commit({ durable: true });
    let commitResolved = false;
    void committing.then(() => { commitResolved = true; });
    await failureObserved;
    await recoveryStarted;
    expect(commitResolved).toBe(false);
    releaseRecovery();
    await committing;

    expect(collection.toArray.map(({ id }) => id).sort()).toEqual(["row-2", "row-3"]);
    await runtime.close();
    collection.cleanup();
  });

  it("does not let an in-flight stale SELECT overwrite a newer commit", async () => {
    const base = createDatabase();
    let holdNextPayloadSelect = false;
    let releaseSelect!: () => void;
    let signalSelectStarted!: () => void;
    const selectGate = new Promise<void>((resolve) => { releaseSelect = resolve; });
    const selectStarted = new Promise<void>((resolve) => { signalSelectStarted = resolve; });
    const database: SqliteDatabase = {
      async execute(sql, params) {
        const result = await base.execute(sql, params);
        if (holdNextPayloadSelect && /^SELECT "__payload"/.test(sql)) {
          holdNextPayloadSelect = false;
          signalSelectStarted();
          await selectGate;
        }
        return result;
      },
      transaction: base.transaction,
    };
    const runtime = createSqliteSyncRuntime<Row, string>({
      id: "stale-select",
      tableName: "stale_select_rows",
      schemaVersion: 1,
      database,
      getKey: (row) => row.id,
      columns: [{ property: "ordinal", column: "ordinal", type: "INTEGER" }],
    });
    const collection = createCollection({ id: "stale-select", getKey: (row: Row) => row.id, syncMode: "on-demand", sync: runtime.sync });
    collection.startSyncImmediate();
    await seed(runtime, [{ id: "row", groupId: "a", ordinal: 1, sealed: true }]);
    const subset = {
      orderBy: [{ expression: new IR.PropRef(["ordinal"]), compareOptions: { direction: "desc", nulls: "last" } }],
      limit: 1,
    } satisfies LoadSubsetOptions;
    holdNextPayloadSelect = true;
    const loading = collection._sync.loadSubset(subset);
    if (loading === true) throw new Error("Expected asynchronous subset load");
    await selectStarted;

    runtime.begin();
    runtime.write({ type: "update", value: { id: "row", groupId: "a", ordinal: 2, sealed: true } });
    await runtime.commit({ durable: true });
    releaseSelect();
    await loading;
    await Promise.resolve();
    await Promise.resolve();

    expect(collection.get("row")?.ordinal).toBe(2);
    await runtime.close();
    collection.cleanup();
  });

  it("does not restore an abandoned pending generation after a newer load fails", async () => {
    const base = createDatabase();
    let interceptedSelect = 0;
    let intercept = false;
    let signalFirstStarted!: () => void;
    let signalSecondStarted!: () => void;
    let signalRetryStarted!: () => void;
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    let releaseRetry!: () => void;
    const firstStarted = new Promise<void>((resolve) => { signalFirstStarted = resolve; });
    const secondStarted = new Promise<void>((resolve) => { signalSecondStarted = resolve; });
    const retryStarted = new Promise<void>((resolve) => { signalRetryStarted = resolve; });
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const retryGate = new Promise<void>((resolve) => { releaseRetry = resolve; });
    const failures: unknown[] = [];
    const database: SqliteDatabase = {
      async execute(sql, params) {
        const result = await base.execute(sql, params);
        if (!intercept || !/^SELECT "__payload"/.test(sql)) return result;
        interceptedSelect += 1;
        if (interceptedSelect === 1) {
          signalFirstStarted();
          await firstGate;
          return result;
        }
        if (interceptedSelect === 2) {
          signalSecondStarted();
          await secondGate;
          throw new Error("newer load failed");
        }
        if (interceptedSelect === 3) {
          signalRetryStarted();
          await retryGate;
        }
        return result;
      },
      transaction: base.transaction,
    };
    const runtime = createSqliteSyncRuntime<Row, string>({
      id: "concurrent-load-rollback",
      tableName: "concurrent_load_rows",
      schemaVersion: 1,
      database,
      getKey: (row) => row.id,
      columns: [{ property: "ordinal", column: "ordinal", type: "INTEGER" }],
      onBackgroundError: (cause) => failures.push(cause),
      subsetRetry: { baseDelayMs: 0, maxDelayMs: 0 },
    });
    const collection = createCollection({ id: "concurrent-load-rollback", getKey: (row: Row) => row.id, syncMode: "on-demand", sync: runtime.sync });
    collection.startSyncImmediate();
    await seed(runtime, [{ id: "row-1", groupId: "a", ordinal: 1, sealed: true }]);
    const subset = {
      orderBy: [{ expression: new IR.PropRef(["ordinal"]), compareOptions: { direction: "desc", nulls: "last" } }],
      limit: 1,
    } satisfies LoadSubsetOptions;

    intercept = true;
    const first = collection._sync.loadSubset(subset);
    if (first === true) throw new Error("Expected first asynchronous subset load");
    await firstStarted;
    const second = collection._sync.loadSubset(subset);
    if (second === true) throw new Error("Expected second asynchronous subset load");
    await secondStarted;
    releaseFirst();
    await first;
    let secondResolved = false;
    void second.then(() => { secondResolved = true; });
    releaseSecond();
    await retryStarted;
    expect(secondResolved).toBe(false);
    releaseRetry();
    await second;
    expect(failures).toHaveLength(1);

    runtime.begin();
    runtime.write({ type: "insert", value: { id: "row-2", groupId: "a", ordinal: 2, sealed: true } });
    await runtime.commit({ durable: true });
    expect(collection.toArray.map(({ id }) => id)).toEqual(["row-2"]);
    await runtime.close();
    collection.cleanup();
  });

  it("automatically retries initial hydration after a transient schema failure", async () => {
    const base = createDatabase();
    let prepareAttempts = 0;
    const failures: unknown[] = [];
    const database: SqliteDatabase = {
      execute: base.execute,
      async transaction<T>(operation: (executor: SqliteExecutor) => Promise<T>) {
        prepareAttempts += 1;
        if (prepareAttempts === 1) throw new Error("schema temporarily unavailable");
        return await base.transaction(operation);
      },
    };
    const runtime = createSqliteSyncRuntime<Row, string>({
      id: "prepare-retry",
      tableName: "prepare_retry_rows",
      schemaVersion: 1,
      database,
      getKey: (row) => row.id,
      columns: [{ property: "ordinal", column: "ordinal", type: "INTEGER" }],
      subsetRetry: { baseDelayMs: 0, maxDelayMs: 0 },
      onBackgroundError: (cause) => failures.push(cause),
    });
    const collection = createCollection({ id: "prepare-retry", getKey: (row: Row) => row.id, syncMode: "on-demand", sync: runtime.sync });
    collection.startSyncImmediate();
    const subset = {
      orderBy: [{ expression: new IR.PropRef(["ordinal"]), compareOptions: { direction: "desc", nulls: "last" } }],
      limit: 1,
    } satisfies LoadSubsetOptions;

    await collection._sync.loadSubset(subset);
    expect(prepareAttempts).toBe(2);
    expect(failures).toHaveLength(1);

    runtime.begin();
    runtime.write({ type: "insert", value: { id: "row", groupId: "a", ordinal: 1, sealed: true } });
    await runtime.commit({ durable: true });
    expect(collection.toArray.map(({ id }) => id)).toEqual(["row"]);
    await runtime.close();
    collection.cleanup();
  });

  it("keeps the initial retry owner when a durable write lands during hydration failure", async () => {
    const base = createDatabase();
    let payloadSelects = 0;
    let signalFailure!: () => void;
    const failureObserved = new Promise<void>((resolve) => { signalFailure = resolve; });
    const database: SqliteDatabase = {
      async execute(sql, params) {
        if (/^SELECT "__payload"/.test(sql)) {
          payloadSelects += 1;
          if (payloadSelects === 1) throw new Error("initial read failed");
        }
        return await base.execute(sql, params);
      },
      transaction: base.transaction,
    };
    const runtime = createSqliteSyncRuntime<Row, string>({
      id: "write-during-subset-retry",
      tableName: "write_during_subset_retry_rows",
      schemaVersion: 1,
      database,
      getKey: (row) => row.id,
      columns: [{ property: "ordinal", column: "ordinal", type: "INTEGER" }],
      subsetRetry: { baseDelayMs: 100, maxDelayMs: 100 },
      onBackgroundError: () => signalFailure(),
    });
    const collection = createCollection({ id: "write-during-subset-retry", getKey: (row: Row) => row.id, syncMode: "on-demand", sync: runtime.sync });
    collection.startSyncImmediate();
    await runtime.prepare();
    const subset = {
      orderBy: [{ expression: new IR.PropRef(["ordinal"]), compareOptions: { direction: "desc", nulls: "last" } }],
      limit: 1,
    } satisfies LoadSubsetOptions;
    const loading = collection._sync.loadSubset(subset);
    if (loading === true) throw new Error("Expected asynchronous subset load");
    let loadResolved = false;
    void loading.then(() => { loadResolved = true; });
    await failureObserved;

    runtime.begin();
    runtime.write({ type: "insert", value: { id: "row", groupId: "a", ordinal: 1, sealed: true } });
    await runtime.commit({ durable: true });
    expect(loadResolved).toBe(false);
    expect(payloadSelects).toBe(1);

    await loading;
    expect(payloadSelects).toBe(2);
    expect(collection.toArray.map(({ id }) => id)).toEqual(["row"]);
    await runtime.close();
    collection.cleanup();
  });

  it("rejects nondeterministic bounded subsets", async () => {
    const runtime = createRuntime(createDatabase());
    await expect(runtime.query({ limit: 1 })).rejects.toThrow("require orderBy");
    await runtime.close();
  });

  it("coalesces writes while preserving immediate collection updates", async () => {
    let checkpoints = 0;
    let transactions = 0;
    const runtime = createSqliteSyncRuntime<Row, string>({
      id: "test-checkpoints",
      tableName: "checkpoint_rows",
      schemaVersion: 1,
      database: createDatabase(),
      getKey: (row) => row.id,
      columns: [{ property: "ordinal", column: "ordinal", type: "INTEGER" }],
      checkpointDelayMs: 100,
      onCheckpoint(sample) {
        checkpoints += 1;
        transactions += sample.transactions;
      },
    });
    const collection = createCollection({ id: "checkpoint-runtime", getKey: (row: Row) => row.id, syncMode: "on-demand", sync: runtime.sync });
    collection.startSyncImmediate();
    runtime.begin();
    runtime.write({ type: "insert", value: { id: "row", groupId: "a", ordinal: 1, sealed: false } });
    const first = runtime.commit();
    runtime.begin();
    runtime.write({ type: "update", value: { id: "row", groupId: "a", ordinal: 2, sealed: true } });
    const second = runtime.commit();

    expect(collection.get("row")?.ordinal).toBe(2);
    await runtime.flush();
    await Promise.all([first, second]);
    expect(checkpoints).toBe(1);
    expect(transactions).toBe(2);
    expect((await runtime.query({}))[0]?.ordinal).toBe(2);
    await runtime.close();
    collection.cleanup();
  });

  it("retries a transient SQLite checkpoint without losing the optimistic write", async () => {
    const base = createDatabase();
    let failNextTransaction = false;
    let failedAttempts = 0;
    const database: SqliteDatabase = {
      execute: base.execute,
      async transaction<T>(operation: (executor: SqliteExecutor) => Promise<T>) {
        if (failNextTransaction) {
          failNextTransaction = false;
          failedAttempts += 1;
          throw new Error("temporary busy");
        }
        return await base.transaction(operation);
      },
    };
    const runtime = createSqliteSyncRuntime<Row, string>({
      id: "checkpoint-retry",
      tableName: "checkpoint_retry_rows",
      schemaVersion: 1,
      database,
      getKey: (row) => row.id,
      columns: [{ property: "ordinal", column: "ordinal", type: "INTEGER" }],
      checkpointRetry: { maxAttempts: 2, baseDelayMs: 0 },
    });
    const collection = createCollection({ id: "checkpoint-retry", getKey: (row: Row) => row.id, syncMode: "on-demand", sync: runtime.sync });
    collection.startSyncImmediate();
    await runtime.prepare();
    failNextTransaction = true;

    await seed(runtime, [{ id: "row", groupId: "a", ordinal: 1, sealed: true }]);

    expect(failedAttempts).toBe(1);
    expect(collection.get("row")?.ordinal).toBe(1);
    expect((await runtime.query({})).map(({ id }) => id)).toEqual(["row"]);
    await runtime.close();
    collection.cleanup();
  });

  it("keeps a terminally failed checkpoint for a no-diff retry", async () => {
    const base = createDatabase();
    let failTransactions = false;
    const database: SqliteDatabase = {
      execute: base.execute,
      async transaction<T>(operation: (executor: SqliteExecutor) => Promise<T>) {
        if (failTransactions) throw new Error("disk unavailable");
        return await base.transaction(operation);
      },
    };
    const runtime = createSqliteSyncRuntime<Row, string>({
      id: "checkpoint-requeue",
      tableName: "checkpoint_requeue_rows",
      schemaVersion: 1,
      database,
      getKey: (row) => row.id,
      columns: [{ property: "ordinal", column: "ordinal", type: "INTEGER" }],
      checkpointRetry: { maxAttempts: 1 },
    });
    const collection = createCollection({ id: "checkpoint-requeue", getKey: (row: Row) => row.id, syncMode: "on-demand", sync: runtime.sync });
    collection.startSyncImmediate();
    await runtime.prepare();
    failTransactions = true;
    runtime.begin();
    runtime.write({ type: "insert", value: { id: "row", groupId: "a", ordinal: 1, sealed: true } });
    await expect(runtime.commit({ durable: true })).rejects.toThrow("disk unavailable");
    expect(collection.get("row")?.ordinal).toBe(1);

    failTransactions = false;
    runtime.begin();
    await runtime.commit();

    expect((await runtime.query({})).map(({ id }) => id)).toEqual(["row"]);
    await runtime.close();
    collection.cleanup();
  });
});
