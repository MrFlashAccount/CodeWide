# `@codewide/tanstack-db-sqlite`

Reusable SQLite-backed `SyncConfig` for TanStack DB.

The package owns the persistence mechanism:

- compilation of TanStack filters, ordering, limits, and offsets into SQL;
- the exact union of active on-demand subsets in the hot collection;
- immediate collection writes with coalesced SQLite checkpoints;
- retrying initial subset hydration without publishing a false ready state;
- table/index creation and schema-version invalidation;
- optional eager hydration and durable handlers for small local collections;
- transactional one-shot bootstrap imports for replacing an older store;
- a small bounded resident set for writes that arrive outside active subsets.

The caller owns the data model and policy. It supplies the row key, serialized
payload, queryable columns, indexes, equality, and operational callbacks. The
package has no knowledge of conversations, pagination cursors, history epochs,
or server reconciliation.

Column encoders define the comparison representation for both SQLite and the
hot collection; they must be deterministic and side-effect free. Their result
must match the declared storage class: string for `TEXT`, a finite number or
boolean for `INTEGER`/`REAL`, or `null` for nullable columns. Binary query
columns are not supported.

Queryable columns must use explicit `null`; `undefined` is rejected before an
optimistic write. This preserves SQLite three-valued predicate semantics in the
hot collection and after reload. Use `isNull` for nullable columns.
`isUndefined` and nullish values inside `in` are intentionally unsupported
because SQLite cannot distinguish a missing value from `NULL`.

Text equality and membership use SQLite's binary value semantics. Text
`like`, range comparisons, and ordering are rejected: SQLite and TanStack DB
do not share one default collation. Numeric `INTEGER`/`REAL` ranges and
ordering remain fully pushed down to SQLite.

```ts
const storage = createSqliteSyncRuntime<Row, string>({
  id: "documents",
  tableName: "documents",
  schemaVersion: 1,
  database,
  getKey: (row) => row.id,
  columns: [
    { property: "workspaceId", column: "workspace_id", type: "TEXT" },
    { property: "updatedAt", column: "updated_at", type: "INTEGER" },
  ],
  indexes: [["workspaceId", "updatedAt"]],
});

const collection = createCollection({
  id: "documents",
  getKey: (row: Row) => row.id,
  syncMode: "on-demand",
  sync: storage.sync,
});

collection.startSyncImmediate();
```

For a small all-resident model, set `initialSync: "all"`, use collection
`syncMode: "eager"`, and spread `storage.mutations` into the collection
configuration. `collection.preload()` then resolves only after SQLite has
published the complete initial snapshot. A `bootstrap` callback runs exactly
once, inside schema preparation, before that snapshot becomes visible.
