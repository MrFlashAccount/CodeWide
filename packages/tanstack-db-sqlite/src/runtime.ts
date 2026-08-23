import type {
  Collection,
  IR,
  LoadSubsetOptions,
  SyncConfig,
} from "@tanstack/db";

export type SqliteValue = string | number | boolean | null | ArrayBuffer | ArrayBufferView;

export type SqliteQueryResult = {
  rows: readonly Record<string, SqliteValue>[];
};

export type SqliteExecutor = {
  execute(sql: string, params?: readonly SqliteValue[]): Promise<SqliteQueryResult | unknown>;
};

export type SqliteDatabase = SqliteExecutor & {
  transaction<T>(operation: (executor: SqliteExecutor) => Promise<T>): Promise<T>;
};

export type SqliteDatabaseLike = {
  execute(sql: string, params?: readonly unknown[]): Promise<unknown>;
  transaction(operation: (executor: { execute(sql: string, params?: readonly unknown[]): Promise<unknown> }) => Promise<void>): Promise<void>;
};

export type SqliteColumnType = "TEXT" | "INTEGER" | "REAL";

export type SqliteColumn<T extends object> = {
  property: Extract<keyof T, string>;
  column: string;
  type: SqliteColumnType;
  nullable?: boolean;
  encode?: (value: T[Extract<keyof T, string>]) => SqliteValue;
};

export type SqliteRuntimeChange<T extends object, TKey extends string | number> =
  | { type: "insert" | "update"; value: T }
  | { type: "delete"; key: TKey };

export type SqliteSyncRuntimeOptions<T extends object, TKey extends string | number> = {
  id: string;
  tableName: string;
  schemaVersion: number;
  database: SqliteDatabase;
  getKey(row: T): TKey;
  columns: readonly SqliteColumn<T>[];
  indexes?: readonly (readonly Extract<keyof T, string>[])[];
  checkpointDelayMs?: number;
  checkpointRetry?: { maxAttempts?: number; baseDelayMs?: number };
  subsetRetry?: { baseDelayMs?: number; maxDelayMs?: number };
  maxManualResidentRows?: number;
  /**
   * `all` makes this runtime the eager source for a small local collection.
   * The collection becomes ready only after the complete SQLite snapshot is
   * resident. Omit it for query-driven/on-demand collections.
   */
  initialSync?: "all";
  /** One-shot import executed in the schema transaction before first load. */
  bootstrap?: {
    id: string;
    load(executor: SqliteExecutor): Promise<readonly T[]>;
  };
  serialize?: (row: T) => string;
  deserialize?: (payload: string) => T;
  equals?: (left: T, right: T) => boolean;
  onSubsetLoad?: (sample: { rows: number; durationMs: number }) => void;
  onCheckpoint?: (sample: { transactions: number; durationMs: number; attempts: number }) => void;
  onBackgroundError?: (cause: unknown) => void;
  onResidentRows?: (rows: readonly T[]) => void;
};

export type SqliteSyncRuntime<T extends object, TKey extends string | number> = {
  readonly sync: SyncConfig<T, TKey>;
  readonly mutations: {
    onInsert(params: SqliteMutationHandlerParams<T, TKey>): Promise<void>;
    onUpdate(params: SqliteMutationHandlerParams<T, TKey>): Promise<void>;
    onDelete(params: SqliteMutationHandlerParams<T, TKey>): Promise<void>;
  };
  prepare(): Promise<void>;
  begin(): void;
  write(change: SqliteRuntimeChange<T, TKey>): void;
  commit(options?: { durable?: boolean }): Promise<void>;
  query(options: LoadSubsetOptions): Promise<T[]>;
  flush(): Promise<void>;
  close(): Promise<void>;
};

export type SqliteMutationHandlerParams<T extends object, TKey extends string | number> = {
  transaction: {
    mutations: ReadonlyArray<{
      key: TKey;
      modified: T;
    }>;
  };
};

type ActiveSubset<T extends object> = {
  options: LoadSubsetOptions;
  rows: Map<string, T> | null;
  revision: number;
};

type PendingCheckpoint<T extends object, TKey extends string | number> = {
  changes: Map<string, SqliteRuntimeChange<T, TKey>>;
  transactionCount: number;
  waiters: Array<{ resolve(): void; reject(cause: unknown): void }>;
};

type SyncControls<T extends object, TKey extends string | number> = {
  collection: Collection<T, TKey, any, any, any>;
  begin(options?: { immediate?: boolean }): void;
  write(change: SqliteRuntimeChange<T, TKey>): void;
  commit(): void;
  markReady(): void;
};

const META_TABLE = "__tanstack_db_sqlite_meta";
const BOOTSTRAP_TABLE = "__tanstack_db_sqlite_bootstrap";
const KEY_COLUMN = "__key";
const PAYLOAD_COLUMN = "__payload";

export function wrapSqliteDatabase(database: SqliteDatabaseLike): SqliteDatabase {
  const executor = (target: Pick<SqliteDatabaseLike, "execute">): SqliteExecutor => ({
    execute: async (sql, params = []) => await target.execute(sql, params),
  });
  return {
    ...executor(database),
    async transaction<T>(operation: (target: SqliteExecutor) => Promise<T>): Promise<T> {
      let result!: T;
      await database.transaction(async (target) => {
        result = await operation(executor(target));
      });
      return result;
    },
  };
}

export function createSqliteSyncRuntime<
  T extends object,
  TKey extends string | number,
>(options: SqliteSyncRuntimeOptions<T, TKey>): SqliteSyncRuntime<T, TKey> {
  validateIdentifier(options.tableName);
  const columnsByProperty = new Map<string, SqliteColumn<T>>();
  const columnsByName = new Set<string>([KEY_COLUMN, PAYLOAD_COLUMN]);
  for (const column of options.columns) {
    validateIdentifier(column.column);
    if (columnsByProperty.has(column.property)) throw new Error(`Duplicate SQLite property ${column.property}`);
    if (columnsByName.has(column.column)) throw new Error(`Duplicate SQLite column ${column.column}`);
    columnsByProperty.set(column.property, column);
    columnsByName.add(column.column);
  }
  for (const index of options.indexes ?? []) {
    if (index.length === 0) throw new Error("SQLite indexes must contain at least one property");
    for (const property of index) {
      if (!columnsByProperty.has(property)) throw new Error(`SQLite index references unknown property ${property}`);
    }
  }

  const serialize = options.serialize ?? JSON.stringify;
  const deserialize = options.deserialize ?? ((payload: string) => JSON.parse(payload) as T);
  const equals = options.equals ?? Object.is;
  const activeSubsets = new Map<number, ActiveSubset<T>>();
  const eagerSubset: LoadSubsetOptions = {};
  const rowPayloads = new WeakMap<T, string>();
  const subsetIds = new WeakMap<object, number>();
  const manualResidents = new Map<string, T>();
  const maxManualResidentRows = options.maxManualResidentRows ?? 256;
  const checkpointDelayMs = options.checkpointDelayMs ?? 250;
  const checkpointMaxAttempts = Math.max(1, options.checkpointRetry?.maxAttempts ?? 3);
  const checkpointRetryBaseDelayMs = Math.max(0, options.checkpointRetry?.baseDelayMs ?? 25);
  const subsetRetryBaseDelayMs = Math.max(1, options.subsetRetry?.baseDelayMs ?? 50);
  const subsetRetryMaxDelayMs = Math.max(subsetRetryBaseDelayMs, options.subsetRetry?.maxDelayMs ?? 1_000);
  let nextSubsetId = 1;
  let controls: SyncControls<T, TKey> | null = null;
  let currentChanges: Map<string, SqliteRuntimeChange<T, TKey>> | null = null;
  let pending: PendingCheckpoint<T, TKey> | null = null;
  let checkpointTimer: ReturnType<typeof setTimeout> | null = null;
  let checkpointTail = Promise.resolve();
  let latestCheckpoint = Promise.resolve();
  let dataRevision = 0;
  let reconcileScheduled = false;
  let closed = false;
  let prepared: Promise<void> | null = null;

  const keyString = (key: TKey): string => `${typeof key}:${String(key)}`;
  const rowKeyString = (row: T): string => keyString(options.getKey(row));

  const ensurePrepared = (): Promise<void> => {
    if (prepared === null) {
      let attempt!: Promise<void>;
      attempt = prepareSchema(options, columnsByProperty).catch((cause) => {
        if (prepared === attempt) prepared = null;
        throw cause;
      });
      prepared = attempt;
    }
    return prepared;
  };

  const query = async (subset: LoadSubsetOptions): Promise<T[]> => {
    if (closed) throw new Error(`SQLite sync runtime ${options.id} is closed`);
    await ensurePrepared();
    await flushPendingCheckpoint();
    const compiled = compileSelect(options.tableName, subset, columnsByProperty);
    const startedAt = performance.now();
    const result = await options.database.execute(compiled.sql, compiled.params);
    const rows = extractRows(result).map((row) => {
      const payload = row[PAYLOAD_COLUMN];
      if (typeof payload !== "string") throw new Error(`SQLite row in ${options.tableName} has no payload`);
      const value = deserialize(payload);
      rowPayloads.set(value, payload);
      return value;
    });
    options.onSubsetLoad?.({ rows: rows.length, durationMs: performance.now() - startedAt });
    return rows;
  };

  const applyResidentUnion = (): void => {
    if (controls === null) return;
    if ([...activeSubsets.values()].some(({ rows }) => rows === null)) return;
    const desired = new Map<string, T>(manualResidents);
    for (const subset of activeSubsets.values()) {
      for (const [key, row] of subset.rows ?? []) desired.set(key, row);
    }
    const current = new Map(controls.collection.toArray.map((row) => [rowKeyString(row), row]));
    controls.begin({ immediate: true });
    for (const [key, row] of current) {
      if (!desired.has(key)) controls.write({ type: "delete", key: options.getKey(row) });
    }
    for (const [key, row] of desired) {
      const previous = current.get(key);
      const previousPayload = previous === undefined ? undefined : rowPayloads.get(previous);
      const nextPayload = rowPayloads.get(row);
      if (previous !== undefined && ((previousPayload !== undefined && previousPayload === nextPayload) || equals(previous, row))) continue;
      controls.write({ type: previous === undefined ? "insert" : "update", value: row });
    }
    controls.commit();
    options.onResidentRows?.([...desired.values()]);
  };

  const scheduleReconcile = (): void => {
    if (reconcileScheduled) return;
    reconcileScheduled = true;
    queueMicrotask(() => {
      reconcileScheduled = false;
      applyResidentUnion();
    });
  };

  const identityForSubset = (subset: LoadSubsetOptions): number => {
    // TanStack reuses one Subscription for every page it requests, but passes
    // the exact LoadSubsetOptions object back to unloadSubset. Keying by the
    // options object therefore preserves the union of all loaded pages.
    const existing = subsetIds.get(subset);
    if (existing !== undefined) return existing;
    const created = nextSubsetId++;
    subsetIds.set(subset, created);
    return created;
  };

  const loadSubset = (subsetOptions: LoadSubsetOptions): Promise<void> => {
    // Reject unsupported query shapes before they can install a pending
    // subset that blocks the resident-union barrier.
    compileSelect(options.tableName, subsetOptions, columnsByProperty);
    return loadValidatedSubset(subsetOptions);
  };

  const loadValidatedSubset = async (subsetOptions: LoadSubsetOptions): Promise<void> => {
    const id = identityForSubset(subsetOptions);
    const previous = activeSubsets.get(id);
    const revision = (previous?.revision ?? 0) + 1;
    activeSubsets.set(id, { options: subsetOptions, rows: previous?.rows ?? null, revision });
    let failedAttempts = 0;
    while (true) {
      try {
        if (!await hydrateSubset(id, revision)) return;
        if ([...activeSubsets.values()].every(({ rows: activeRows }) => activeRows !== null)) {
          manualResidents.clear();
        }
        applyResidentUnion();
        return;
      } catch (cause) {
        const current = activeSubsets.get(id);
        if (current?.revision !== revision) return;
        options.onBackgroundError?.(cause);
        if (previous !== undefined && previous.rows !== null) {
          activeSubsets.set(id, previous);
          applyResidentUnion();
          return;
        }
        // Initial demand is not ready until its rows exist. Keep the promise
        // pending and retry internally; unload or a newer generation cancels
        // this loop through the revision check in hydrateSubset.
        failedAttempts += 1;
        await delay(subsetRetryDelay(failedAttempts));
      }
    }
  };

  const hydrateSubset = async (id: number, revision: number): Promise<boolean> => {
    while (true) {
      const active = activeSubsets.get(id);
      if (active === undefined || active.revision !== revision) return false;
      const observedDataRevision = dataRevision;
      const rows = await query(active.options);
      const current = activeSubsets.get(id);
      if (current === undefined || current.revision !== revision) return false;
      // A commit may land after query() flushed but before its SELECT resolves.
      // Retry rather than letting that older snapshot replace the write.
      if (dataRevision !== observedDataRevision) continue;
      activeSubsets.set(id, {
        ...current,
        rows: new Map(rows.map((row) => [rowKeyString(row), row])),
      });
      return true;
    }
  };

  const unloadSubset = (subsetOptions: LoadSubsetOptions): void => {
    const id = subsetIds.get(subsetOptions);
    if (id === undefined) return;
    activeSubsets.delete(id);
    scheduleReconcile();
  };

  const installControls = (next: SyncControls<T, TKey>): (() => void) => {
    controls = next;
    if (options.initialSync === "all") {
      void loadValidatedSubset(eagerSubset).then(() => {
        if (controls === next) next.markReady();
      }).catch(options.onBackgroundError ?? (() => undefined));
    } else {
      next.markReady();
    }
    return () => {
      if (controls !== next) return;
      if (options.initialSync === "all") {
        const subsetId = subsetIds.get(eagerSubset);
        if (subsetId !== undefined) activeSubsets.delete(subsetId);
      }
      controls = null;
    };
  };

  const sync: SyncConfig<T, TKey> = {
    rowUpdateMode: "full",
    sync: (params) => ({
      loadSubset,
      unloadSubset,
      cleanup: installControls(params as SyncControls<T, TKey>),
    }),
  };

  const ensureControls = (): SyncControls<T, TKey> => {
    if (controls !== null) return controls;
    throw new Error(`SQLite sync runtime ${options.id} has not been started by its collection`);
  };

  const begin = (): void => {
    if (currentChanges !== null) throw new Error(`SQLite sync runtime ${options.id} already has an open transaction`);
    currentChanges = new Map();
  };

  const write = (change: SqliteRuntimeChange<T, TKey>): void => {
    if (currentChanges === null) throw new Error(`SQLite sync runtime ${options.id} has no open transaction`);
    if (change.type !== "delete") validateQueryableColumns(change.value, options.columns);
    const key = change.type === "delete" ? change.key : options.getKey(change.value);
    currentChanges.set(keyString(key), change);
  };

  const commit = (commitOptions: { durable?: boolean } = {}): Promise<void> => {
    const changes = currentChanges;
    if (changes === null) throw new Error(`SQLite sync runtime ${options.id} has no open transaction`);
    currentChanges = null;
    const activeControls = ensureControls();
    activeControls.begin({ immediate: true });
    let needsReload = false;
    if (changes.size > 0) dataRevision += 1;
    if ([...activeSubsets.values()].some(({ rows }) => rows === null)) needsReload = true;
    for (const change of changes.values()) {
      activeControls.write(change);
      const key = change.type === "delete" ? keyString(change.key) : rowKeyString(change.value);
      let ownedBySubset = false;
      let matchedSubset = false;
      for (const subset of activeSubsets.values()) {
        if (subset.rows === null) continue;
        if ((subset.options.offset ?? 0) > 0 || subset.options.cursor !== undefined) {
          if (subset.rows.has(key) || (change.type !== "delete" && matchesWhere(change.value, subset.options.where, columnsByProperty))) {
            needsReload = true;
          }
          continue;
        }
        if (change.type === "delete") {
          if (subset.rows.delete(key) && subset.options.limit !== undefined) needsReload = true;
          continue;
        }
        if (matchesWhere(change.value, subset.options.where, columnsByProperty)) {
          matchedSubset = true;
          subset.rows.set(key, change.value);
          trimSubset(subset.rows, subset.options, columnsByProperty);
          ownedBySubset ||= subset.rows.has(key);
          // A bounded cache cannot know the omitted boundary row. Any matching
          // insert/update may change page membership even when its size stays
          // constant, so SQLite remains the source of truth for the final set.
          if (subset.options.limit !== undefined) needsReload = true;
        } else if (subset.rows.delete(key) && subset.options.limit !== undefined) {
          needsReload = true;
        }
      }
      if (change.type === "delete") manualResidents.delete(key);
      else if (ownedBySubset) manualResidents.delete(key);
      else if (matchedSubset) manualResidents.delete(key);
      else {
        manualResidents.delete(key);
        manualResidents.set(key, change.value);
        while (manualResidents.size > maxManualResidentRows) {
          const oldest = manualResidents.keys().next().value as string | undefined;
          if (oldest === undefined) break;
          manualResidents.delete(oldest);
        }
      }
      if (change.type !== "delete") rowPayloads.set(change.value, serialize(change.value));
    }
    activeControls.commit();
    if (changes.size === 0) return pending === null ? latestCheckpoint : flushPendingCheckpoint();
    const checkpoint = enqueueCheckpoint(changes);
    if (commitOptions.durable === true) void flushPendingCheckpoint();
    return needsReload ? checkpoint.then(refreshActiveSubsets) : checkpoint;
  };

  const persistMutation = async (
    type: "insert" | "update" | "delete",
    params: SqliteMutationHandlerParams<T, TKey>,
  ): Promise<void> => {
    begin();
    for (const mutation of params.transaction.mutations) {
      write(type === "delete"
        ? { type: "delete", key: mutation.key }
        : { type, value: mutation.modified });
    }
    let checkpoint = commit({ durable: true });
    let failedAttempts = 0;
    while (true) {
      try {
        await checkpoint;
        return;
      } catch (cause) {
        // A local collection mutation must not be acknowledged or rolled back
        // while its already-confirmed hot row is merely waiting for SQLite.
        // The failed checkpoint was requeued by flushPendingCheckpoint; keep
        // this TanStack transaction pending until that exact state is durable.
        options.onBackgroundError?.(cause);
        failedAttempts += 1;
        await delay(subsetRetryDelay(failedAttempts));
        checkpoint = flushPendingCheckpoint();
      }
    }
  };

  const mutations = {
    onInsert: async (params: SqliteMutationHandlerParams<T, TKey>) => await persistMutation("insert", params),
    onUpdate: async (params: SqliteMutationHandlerParams<T, TKey>) => await persistMutation("update", params),
    onDelete: async (params: SqliteMutationHandlerParams<T, TKey>) => await persistMutation("delete", params),
  };

  const enqueueCheckpoint = (changes: Map<string, SqliteRuntimeChange<T, TKey>>): Promise<void> => {
    pending ??= { changes: new Map(), transactionCount: 0, waiters: [] };
    for (const [key, change] of changes) pending.changes.set(key, change);
    pending.transactionCount += 1;
    const checkpoint = new Promise<void>((resolve, reject) => pending?.waiters.push({ resolve, reject }));
    if (checkpointTimer === null) {
      checkpointTimer = setTimeout(() => {
        checkpointTimer = null;
        void flushPendingCheckpoint().catch(options.onBackgroundError ?? (() => undefined));
      }, checkpointDelayMs);
    }
    return checkpoint;
  };

  const refreshActiveSubsets = async (): Promise<void> => {
    for (const [id, subset] of activeSubsets) {
      // A never-ready subset already owns a retry loop. Superseding its
      // revision here would acknowledge that original demand without rows and
      // leave the replacement generation without an owner.
      if (subset.rows === null) continue;
      const revision = subset.revision + 1;
      activeSubsets.set(id, { ...subset, revision });
      let failedAttempts = 0;
      while (true) {
        try {
          if (!await hydrateSubset(id, revision)) break;
          break;
        } catch (cause) {
          const current = activeSubsets.get(id);
          if (current?.revision !== revision) break;
          options.onBackgroundError?.(cause);
          failedAttempts += 1;
          await delay(subsetRetryDelay(failedAttempts));
        }
      }
    }
    if ([...activeSubsets.values()].every(({ rows }) => rows !== null)) manualResidents.clear();
    applyResidentUnion();
  };

  const subsetRetryDelay = (failedAttempts: number): number => Math.min(
    subsetRetryMaxDelayMs,
    subsetRetryBaseDelayMs * (2 ** Math.min(failedAttempts - 1, 8)),
  );

  const flushPendingCheckpoint = (): Promise<void> => {
    if (checkpointTimer !== null) clearTimeout(checkpointTimer);
    checkpointTimer = null;
    const checkpoint = pending;
    pending = null;
    if (checkpoint === null) return latestCheckpoint;
    const operation = checkpointTail.then(async () => {
      await ensurePrepared();
      const startedAt = performance.now();
      let attempts = 0;
      await withRetry(async () => {
        attempts += 1;
        await options.database.transaction(async (executor) => {
          for (const change of checkpoint.changes.values()) {
            if (change.type === "delete") {
              await executor.execute(
                `DELETE FROM ${quoteIdentifier(options.tableName)} WHERE ${quoteIdentifier(KEY_COLUMN)} = ?`,
                [keyString(change.key)],
              );
            } else {
              const row = change.value;
              const columnValues = options.columns.map((column) => encodeColumn(column, row));
              const names = [KEY_COLUMN, PAYLOAD_COLUMN, ...options.columns.map(({ column }) => column)];
              const params: SqliteValue[] = [rowKeyString(row), serialize(row), ...columnValues];
              await executor.execute(
                `INSERT INTO ${quoteIdentifier(options.tableName)} (${names.map(quoteIdentifier).join(", ")}) VALUES (${names.map(() => "?").join(", ")}) `
                + `ON CONFLICT(${quoteIdentifier(KEY_COLUMN)}) DO UPDATE SET ${names.slice(1).map((name) => `${quoteIdentifier(name)} = excluded.${quoteIdentifier(name)}`).join(", ")}`,
                params,
              );
            }
          }
        });
      }, checkpointMaxAttempts, checkpointRetryBaseDelayMs);
      options.onCheckpoint?.({ transactions: checkpoint.transactionCount, durationMs: performance.now() - startedAt, attempts });
    });
    latestCheckpoint = operation;
    checkpointTail = operation.catch(() => undefined);
    void operation.then(
      () => checkpoint.waiters.forEach(({ resolve }) => resolve()),
      (cause) => {
        // Keep the newest change for every key pending. A caller retry that
        // computes no semantic diff can then flush the failed checkpoint
        // instead of acknowledging an optimistic row that never reached disk.
        pending ??= { changes: new Map(), transactionCount: 0, waiters: [] };
        for (const [key, change] of checkpoint.changes) {
          if (!pending.changes.has(key)) pending.changes.set(key, change);
        }
        pending.transactionCount += checkpoint.transactionCount;
        checkpoint.waiters.forEach(({ reject }) => reject(cause));
      },
    );
    return operation;
  };

  return {
    sync,
    mutations,
    prepare: ensurePrepared,
    begin,
    write,
    commit,
    query,
    flush: flushPendingCheckpoint,
    async close() {
      if (closed) return;
      await flushPendingCheckpoint();
      closed = true;
      activeSubsets.clear();
      manualResidents.clear();
      controls = null;
    },
  };
}

async function prepareSchema<T extends object, TKey extends string | number>(
  options: SqliteSyncRuntimeOptions<T, TKey>,
  columns: ReadonlyMap<string, SqliteColumn<T>>,
): Promise<void> {
  await options.database.transaction(async (executor) => {
    await executor.execute(
      `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(META_TABLE)} (`
      + `${quoteIdentifier("runtime_id")} TEXT PRIMARY KEY NOT NULL, `
      + `${quoteIdentifier("schema_version")} INTEGER NOT NULL)`,
    );
    await executor.execute(
      `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(BOOTSTRAP_TABLE)} (`
      + `${quoteIdentifier("runtime_id")} TEXT NOT NULL, `
      + `${quoteIdentifier("bootstrap_id")} TEXT NOT NULL, `
      + `PRIMARY KEY (${quoteIdentifier("runtime_id")}, ${quoteIdentifier("bootstrap_id")}))`,
    );
    const versionResult = await executor.execute(
      `SELECT ${quoteIdentifier("schema_version")} FROM ${quoteIdentifier(META_TABLE)} WHERE ${quoteIdentifier("runtime_id")} = ?`,
      [options.id],
    );
    const previousVersion = extractRows(versionResult)[0]?.schema_version;
    if (typeof previousVersion === "number" && previousVersion !== options.schemaVersion) {
      await executor.execute(`DROP TABLE IF EXISTS ${quoteIdentifier(options.tableName)}`);
    }
    const columnSql = [...columns.values()].map((column) => (
      `${quoteIdentifier(column.column)} ${column.type}${column.nullable === true ? "" : " NOT NULL"}`
    ));
    await executor.execute(
      `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(options.tableName)} (`
      + `${quoteIdentifier(KEY_COLUMN)} TEXT PRIMARY KEY NOT NULL, `
      + `${quoteIdentifier(PAYLOAD_COLUMN)} TEXT NOT NULL`
      + `${columnSql.length === 0 ? "" : `, ${columnSql.join(", ")}`})`,
    );
    for (const [position, index] of (options.indexes ?? []).entries()) {
      const indexName = `${options.tableName}__idx_${position}`;
      const indexColumns = index.map((property) => columns.get(property)?.column);
      if (indexColumns.some((column) => column === undefined)) throw new Error(`Invalid SQLite index ${indexName}`);
      await executor.execute(
        `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(indexName)} ON ${quoteIdentifier(options.tableName)} (${indexColumns.map((column) => quoteIdentifier(column!)).join(", ")})`,
      );
    }
    if (options.bootstrap !== undefined) {
      const bootstrapResult = await executor.execute(
        `SELECT 1 AS ${quoteIdentifier("present")} FROM ${quoteIdentifier(BOOTSTRAP_TABLE)} `
        + `WHERE ${quoteIdentifier("runtime_id")} = ? AND ${quoteIdentifier("bootstrap_id")} = ?`,
        [options.id, options.bootstrap.id],
      );
      if (extractRows(bootstrapResult).length === 0) {
        const countResult = await executor.execute(
          `SELECT COUNT(*) AS ${quoteIdentifier("row_count")} FROM ${quoteIdentifier(options.tableName)}`,
        );
        if (extractRows(countResult)[0]?.row_count === 0) {
          const rows = await options.bootstrap.load(executor);
          const serialize = options.serialize ?? JSON.stringify;
          for (const row of rows) {
            validateQueryableColumns(row, options.columns);
            const values = options.columns.map((column) => encodeColumn(column, row));
            await executor.execute(
              `INSERT OR REPLACE INTO ${quoteIdentifier(options.tableName)} (`
              + `${quoteIdentifier(KEY_COLUMN)}, ${quoteIdentifier(PAYLOAD_COLUMN)}`
              + `${options.columns.length === 0 ? "" : `, ${options.columns.map((column) => quoteIdentifier(column.column)).join(", ")}`}) `
              + `VALUES (${Array.from({ length: 2 + options.columns.length }, () => "?").join(", ")})`,
              [keyForStorage(options.getKey(row)), serialize(row), ...values],
            );
          }
        }
        await executor.execute(
          `INSERT INTO ${quoteIdentifier(BOOTSTRAP_TABLE)} (${quoteIdentifier("runtime_id")}, ${quoteIdentifier("bootstrap_id")}) VALUES (?, ?)`,
          [options.id, options.bootstrap.id],
        );
      }
    }
    await executor.execute(
      `INSERT INTO ${quoteIdentifier(META_TABLE)} (${quoteIdentifier("runtime_id")}, ${quoteIdentifier("schema_version")}) VALUES (?, ?) `
      + `ON CONFLICT(${quoteIdentifier("runtime_id")}) DO UPDATE SET ${quoteIdentifier("schema_version")} = excluded.${quoteIdentifier("schema_version")}`,
      [options.id, options.schemaVersion],
    );
  });
}

function keyForStorage(key: string | number): string {
  return `${typeof key}:${String(key)}`;
}

function compileSelect<T extends object>(
  tableName: string,
  options: LoadSubsetOptions,
  columns: ReadonlyMap<string, SqliteColumn<T>>,
): { sql: string; params: SqliteValue[] } {
  if ((options.limit !== undefined || options.offset !== undefined) && (options.orderBy === undefined || options.orderBy.length === 0)) {
    throw new Error("SQLite LIMIT and OFFSET require orderBy for deterministic subsets");
  }
  const params: SqliteValue[] = [];
  let sql = `SELECT ${quoteIdentifier(PAYLOAD_COLUMN)} FROM ${quoteIdentifier(tableName)}`;
  if (options.where !== undefined) sql += ` WHERE ${compileExpression(options.where, columns, params)}`;
  if (options.orderBy !== undefined && options.orderBy.length > 0) {
    const clauses = options.orderBy.map(({ expression, compareOptions }) => {
      const property = propertyForExpression(expression);
      const column = columns.get(property);
      if (column === undefined) throw new Error(`SQLite orderBy references unconfigured property ${property}`);
      if (column.type === "TEXT") {
        throw new Error(`SQLite TEXT orderBy is unsupported because its collation differs from TanStack DB`);
      }
      const direction = compareOptions.direction === "desc" ? "DESC" : "ASC";
      const nulls = compareOptions.nulls === "first" ? "NULLS FIRST" : "NULLS LAST";
      return `${quoteIdentifier(column.column)} ${direction} ${nulls}`;
    });
    clauses.push(`${quoteIdentifier(KEY_COLUMN)} ASC`);
    sql += ` ORDER BY ${clauses.join(", ")}`;
  }
  if (options.limit !== undefined) {
    sql += " LIMIT ?";
    params.push(options.limit);
    if (options.offset !== undefined) {
      sql += " OFFSET ?";
      params.push(options.offset);
    }
  } else if (options.offset !== undefined) {
    sql += " LIMIT -1 OFFSET ?";
    params.push(options.offset);
  }
  return { sql, params };
}

function compileExpression<T extends object>(
  expression: IR.BasicExpression,
  columns: ReadonlyMap<string, SqliteColumn<T>>,
  params: SqliteValue[],
): string {
  if (expression.type === "ref") {
    if (expression.path.length !== 1) throw new Error("SQLite expressions only support top-level properties");
    const property = expression.path.at(-1);
    if (property === undefined) throw new Error("SQLite expression has an empty property path");
    const column = columns.get(property);
    if (column === undefined) throw new Error(`SQLite expression references unconfigured property ${property}`);
    return quoteIdentifier(column.column);
  }
  if (expression.type === "val") {
    if (Array.isArray(expression.value)) {
      if (expression.value.length === 0) return "(SELECT 1 WHERE 0)";
      return `(${expression.value.map((value) => {
        params.push(toSqliteValue(value));
        return "?";
      }).join(", ")})`;
    }
    params.push(toSqliteValue(expression.value));
    return "?";
  }
  if (expression.name === "like") {
    throw new Error("SQLite like is unsupported because its case sensitivity differs from TanStack DB");
  }
  const binary: Record<string, string> = { eq: "=", ne: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" };
  const operator = binary[expression.name];
  if (operator !== undefined) {
    if (expression.args.length !== 2) throw new Error(`SQLite ${expression.name} expects two arguments`);
    if (["gt", "gte", "lt", "lte"].includes(expression.name)) {
      rejectTextComparison(expression, columns, expression.name);
    }
    const pair = compileColumnValuePair(expression.args[0]!, expression.args[1]!, columns, params);
    if (pair !== null) return `(${pair.left} ${operator} ${pair.right})`;
    return `(${compileExpression(expression.args[0]!, columns, params)} ${operator} ${compileExpression(expression.args[1]!, columns, params)})`;
  }
  if (expression.name === "in") {
    if (expression.args.length !== 2) throw new Error("SQLite in expects two arguments");
    const right = expression.args[1]!;
    if (right.type === "val" && Array.isArray(right.value) && right.value.some(isNullish)) {
      throw new Error("SQLite in does not support nullish values; use isNull explicitly");
    }
    const pair = compileColumnValuePair(expression.args[0]!, expression.args[1]!, columns, params);
    if (pair !== null) return `(${pair.left} IN ${pair.right})`;
    return `(${compileExpression(expression.args[0]!, columns, params)} IN ${compileExpression(expression.args[1]!, columns, params)})`;
  }
  if (expression.name === "and" || expression.name === "or") {
    if (expression.args.length === 0) return expression.name === "and" ? "1" : "0";
    const joiner = expression.name === "and" ? " AND " : " OR ";
    return `(${expression.args.map((argument) => compileExpression(argument, columns, params)).join(joiner)})`;
  }
  if (expression.name === "not") {
    if (expression.args.length !== 1) throw new Error("SQLite not expects one argument");
    return `(NOT ${compileExpression(expression.args[0]!, columns, params)})`;
  }
  if (expression.name === "isNull") {
    if (expression.args.length !== 1) throw new Error("SQLite isNull expects one argument");
    return `(${compileExpression(expression.args[0]!, columns, params)} IS NULL)`;
  }
  if (expression.name === "isUndefined") {
    throw new Error("SQLite queryable columns require explicit null; isUndefined is unsupported");
  }
  throw new Error(`Unsupported SQLite operator ${expression.name}`);
}

function compileColumnValuePair<T extends object>(
  left: IR.BasicExpression,
  right: IR.BasicExpression,
  columns: ReadonlyMap<string, SqliteColumn<T>>,
  params: SqliteValue[],
): { left: string; right: string } | null {
  const ref = left.type === "ref" ? left : right.type === "ref" ? right : null;
  const value = left.type === "val" ? left : right.type === "val" ? right : null;
  if (ref === null || value === null) return null;
  if (ref.path.length !== 1) throw new Error("SQLite expressions only support top-level properties");
  const property = ref.path.at(-1);
  if (property === undefined) throw new Error("SQLite expression has an empty property path");
  const column = columns.get(property);
  if (column === undefined) throw new Error(`SQLite expression references unconfigured property ${property}`);
  const encoded = Array.isArray(value.value)
    ? value.value.length === 0
      ? "(SELECT 1 WHERE 0)"
      : `(${value.value.map((entry) => {
          params.push(encodeExpressionValue(column, entry));
          return "?";
        }).join(", ")})`
    : (() => {
        params.push(encodeExpressionValue(column, value.value));
        return "?";
      })();
  const compiledRef = quoteIdentifier(column.column);
  return left === ref
    ? { left: compiledRef, right: encoded }
    : { left: encoded, right: compiledRef };
}

function rejectTextComparison<T extends object>(
  expression: IR.BasicExpression,
  columns: ReadonlyMap<string, SqliteColumn<T>>,
  operator: string,
): void {
  if (expression.type === "val") return;
  if (expression.type === "ref") {
    if (expression.path.length !== 1) throw new Error("SQLite expressions only support top-level properties");
    const property = expression.path.at(-1);
    if (property === undefined) throw new Error("SQLite expression has an empty property path");
    const column = columns.get(property);
    if (column === undefined) throw new Error(`SQLite expression references unconfigured property ${property}`);
    if (column.type === "TEXT") {
      throw new Error(`SQLite TEXT ${operator} is unsupported because its collation differs from TanStack DB`);
    }
    return;
  }
  for (const argument of expression.args) rejectTextComparison(argument, columns, operator);
}

function encodeExpressionValue<T extends object>(column: SqliteColumn<T>, value: unknown): SqliteValue {
  if (value === undefined) {
    throw new Error(`SQLite query value for ${column.property} must use explicit null instead of undefined`);
  }
  const encoded = column.encode !== undefined
    ? column.encode(value as T[Extract<keyof T, string>])
    : toSqliteValue(value);
  if (encoded === null) return null;
  if (column.type === "TEXT") {
    if (typeof encoded !== "string") throw new Error(`SQLite TEXT column ${column.property} encoder must return string or null`);
    return encoded;
  }
  if (typeof encoded === "boolean") return encoded ? 1 : 0;
  if (typeof encoded !== "number" || !Number.isFinite(encoded)) {
    throw new Error(`SQLite ${column.type} column ${column.property} encoder must return a finite number, boolean, or null`);
  }
  if (column.type === "INTEGER" && !Number.isInteger(encoded)) {
    throw new Error(`SQLite INTEGER column ${column.property} encoder must return an integer`);
  }
  return encoded;
}

function matchesWhere<T extends object>(
  row: T,
  expression: IR.BasicExpression<boolean> | undefined,
  columns: ReadonlyMap<string, SqliteColumn<T>>,
): boolean {
  if (expression === undefined) return true;
  return evaluateExpression(row, expression, columns) === true;
}

function evaluateExpression<T extends object>(
  row: T,
  expression: IR.BasicExpression,
  columns: ReadonlyMap<string, SqliteColumn<T>>,
): unknown {
  if (expression.type === "ref") {
    const property = expression.path.at(-1);
    if (property === undefined) return undefined;
    const column = columns.get(property);
    if (column === undefined) throw new Error(`SQLite expression references unconfigured property ${property}`);
    return encodeExpressionValue(column, (row as Record<string, unknown>)[property]);
  }
  if (expression.type === "val") return expression.value;
  const values = expression.args.map((argument) => evaluateExpression(row, argument, columns));
  if (expression.args.length === 2) {
    const refIndex = expression.args.findIndex((argument) => argument.type === "ref");
    const valueIndex = expression.args.findIndex((argument) => argument.type === "val");
    if (refIndex >= 0 && valueIndex >= 0) {
      const reference = expression.args[refIndex]!;
      if (reference.type !== "ref") throw new Error("Expected SQLite property reference");
      const property = reference.path.at(-1);
      if (property === undefined) throw new Error("SQLite expression has an empty property path");
      const column = columns.get(property);
      if (column === undefined) throw new Error(`SQLite expression references unconfigured property ${property}`);
      const literal = values[valueIndex];
      values[valueIndex] = Array.isArray(literal)
        ? literal.map((entry) => encodeExpressionValue(column, entry))
        : encodeExpressionValue(column, literal);
    }
  }
  switch (expression.name) {
    case "eq": return values.some(isNullish) ? null : values[0] === values[1];
    case "ne": return values.some(isNullish) ? null : values[0] !== values[1];
    case "gt": return values.some(isNullish) ? null : compareValues(values[0], values[1]) > 0;
    case "gte": return values.some(isNullish) ? null : compareValues(values[0], values[1]) >= 0;
    case "lt": return values.some(isNullish) ? null : compareValues(values[0], values[1]) < 0;
    case "lte": return values.some(isNullish) ? null : compareValues(values[0], values[1]) <= 0;
    case "in": return isNullish(values[0]) ? null : Array.isArray(values[1]) && values[1].includes(values[0]);
    case "and": return values.includes(false) ? false : values.some(isNullish) ? null : true;
    case "or": return values.includes(true) ? true : values.some(isNullish) ? null : false;
    case "not": return isNullish(values[0]) ? null : !values[0];
    case "isNull": return values[0] === null;
    case "isUndefined": return values[0] === undefined;
    case "like": return values.some(isNullish) ? null : typeof values[0] === "string" && typeof values[1] === "string"
      ? likePattern(values[1]).test(values[0])
      : false;
    default: throw new Error(`Unsupported SQLite operator ${expression.name}`);
  }
}

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

function trimSubset<T extends object>(
  rows: Map<string, T>,
  options: LoadSubsetOptions,
  columns: ReadonlyMap<string, SqliteColumn<T>>,
): void {
  if (options.orderBy === undefined && options.limit === undefined && options.offset === undefined) return;
  const ordered = [...rows.entries()];
  if (options.orderBy !== undefined) {
    ordered.sort(([leftKey, left], [rightKey, right]) => {
      for (const clause of options.orderBy ?? []) {
        const property = propertyForExpression(clause.expression);
        if (!columns.has(property)) throw new Error(`SQLite orderBy references unconfigured property ${property}`);
        const column = columns.get(property);
        if (column === undefined) throw new Error(`SQLite orderBy references unconfigured property ${property}`);
        const compared = compareNullable(
          encodeExpressionValue(column, (left as Record<string, unknown>)[property]),
          encodeExpressionValue(column, (right as Record<string, unknown>)[property]),
          clause.compareOptions.nulls,
        );
        if (compared !== 0) return clause.compareOptions.direction === "desc" ? -compared : compared;
      }
      return leftKey.localeCompare(rightKey);
    });
  }
  const offset = options.offset ?? 0;
  const retained = new Set(ordered.slice(offset, options.limit === undefined ? undefined : offset + options.limit).map(([key]) => key));
  for (const key of rows.keys()) {
    if (!retained.has(key)) rows.delete(key);
  }
}

function compareNullable(left: unknown, right: unknown, nulls: "first" | "last"): number {
  const leftNull = left === null || left === undefined;
  const rightNull = right === null || right === undefined;
  if (leftNull && rightNull) return 0;
  if (leftNull) return nulls === "first" ? -1 : 1;
  if (rightNull) return nulls === "first" ? 1 : -1;
  return compareValues(left, right);
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right));
}

function likePattern(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/%/g, ".*").replace(/_/g, ".")}$`, "s");
}

function propertyForExpression(expression: IR.BasicExpression): string {
  if (expression.type !== "ref") throw new Error("SQLite orderBy only supports property references");
  if (expression.path.length !== 1) throw new Error("SQLite expressions only support top-level properties");
  const property = expression.path.at(-1);
  if (property === undefined) throw new Error("SQLite orderBy has an empty property path");
  return property;
}

function encodeColumn<T extends object>(column: SqliteColumn<T>, row: T): SqliteValue {
  const value = row[column.property];
  if (value === undefined) {
    throw new Error(`SQLite queryable column ${column.property} must use explicit null instead of undefined`);
  }
  if (value === null && column.nullable !== true) {
    throw new Error(`SQLite queryable column ${column.property} is not nullable`);
  }
  return encodeExpressionValue(column, value);
}

function validateQueryableColumns<T extends object>(row: T, columns: readonly SqliteColumn<T>[]): void {
  for (const column of columns) {
    encodeColumn(column, row);
  }
}

function toSqliteValue(value: unknown): SqliteValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;
  throw new Error(`Unsupported SQLite value ${typeof value}`);
}

function extractRows(result: unknown): readonly Record<string, SqliteValue>[] {
  if (Array.isArray(result)) return result as readonly Record<string, SqliteValue>[];
  if (typeof result !== "object" || result === null) return [];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows as readonly Record<string, SqliteValue>[] : [];
}

function quoteIdentifier(identifier: string): string {
  validateIdentifier(identifier);
  return `"${identifier}"`;
}

function validateIdentifier(identifier: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error(`Unsafe SQLite identifier ${identifier}`);
}

async function withRetry(operation: () => Promise<void>, maxAttempts: number, baseDelayMs: number): Promise<void> {
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      await operation();
      return;
    } catch (cause) {
      if (attempt >= maxAttempts) throw cause;
      await delay(baseDelayMs * attempt);
    }
  }
}

function delay(durationMs: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, durationMs));
}
