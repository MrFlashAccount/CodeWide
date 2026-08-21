import type { PersistedCollectionPersistence } from "@tanstack/react-native-db-sqlite-persistence";

import type { ClaimedCommit } from "./durable-commit-tracker";

type PersistenceAdapter = PersistedCollectionPersistence["adapter"];
export type PersistedTransaction = Parameters<PersistenceAdapter["applyCommittedTx"]>[1];

type PendingBatch = {
  transaction: PersistedTransaction | null;
  transactionCount: number;
  commits: ClaimedCommit[];
  timer: ReturnType<typeof setTimeout> | null;
  tail: Promise<void>;
};

/**
 * Collapses disposable UI-cache writes without slowing the live collection.
 *
 * TanStack applies an external-sync transaction to the in-memory collection
 * before it calls the persistence adapter. Returning from enqueue therefore
 * releases the collection immediately while the latest row state is written
 * to SQLite on the next checkpoint. Forced commits flush every earlier write
 * first and retain the existing durable-boundary contract.
 */
export class CoalescedPersistenceWriter {
  readonly #delayMs: number;
  readonly #persist: (collectionId: string, transaction: PersistedTransaction) => Promise<void>;
  readonly #onBackgroundError: (cause: unknown) => void;
  readonly #onCheckpoint: (collectionId: string, transactionCount: number) => void;
  readonly #states = new Map<string, PendingBatch>();

  constructor(options: {
    delayMs: number;
    persist(collectionId: string, transaction: PersistedTransaction): Promise<void>;
    onBackgroundError?(cause: unknown): void;
    onCheckpoint?(collectionId: string, transactionCount: number): void;
  }) {
    this.#delayMs = options.delayMs;
    this.#persist = options.persist;
    this.#onBackgroundError = options.onBackgroundError ?? (() => undefined);
    this.#onCheckpoint = options.onCheckpoint ?? (() => undefined);
  }

  enqueue(
    collectionId: string,
    transaction: PersistedTransaction,
    commit: ClaimedCommit | null,
  ): Promise<void> {
    const state = this.#state(collectionId);
    state.transaction = state.transaction === null
      ? transaction
      : coalescePersistedTransactions([state.transaction, transaction]);
    state.transactionCount += 1;
    if (commit !== null) state.commits.push(commit);
    if (commit?.forceFlush === true) return this.flush(collectionId);
    if (state.timer === null) {
      state.timer = setTimeout(() => {
        state.timer = null;
        void this.flush(collectionId).catch(this.#onBackgroundError);
      }, this.#delayMs);
    }
    return Promise.resolve();
  }

  flush(collectionId: string): Promise<void> {
    const state = this.#states.get(collectionId);
    if (state === undefined) return Promise.resolve();
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = null;
    if (state.transaction === null) return state.tail;

    const transaction = state.transaction;
    const transactionCount = state.transactionCount;
    state.transaction = null;
    state.transactionCount = 0;
    const commits = state.commits.splice(0);
    const persisted = state.tail.then(async () => {
      await this.#persist(collectionId, transaction);
      this.#onCheckpoint(collectionId, transactionCount);
    });
    state.tail = persisted.catch(() => undefined);
    void persisted.then(
      () => { commits.forEach((commit) => commit.resolve()); },
      (cause) => { commits.forEach((commit) => commit.reject(cause)); },
    );
    return persisted;
  }

  #state(collectionId: string): PendingBatch {
    const existing = this.#states.get(collectionId);
    if (existing !== undefined) return existing;
    const created: PendingBatch = {
      transaction: null,
      transactionCount: 0,
      commits: [],
      timer: null,
      tail: Promise.resolve(),
    };
    this.#states.set(collectionId, created);
    return created;
  }
}

/** Latest row/metadata mutation wins; the newest stream position represents
 * the entire collapsed checkpoint. UI-cache sync writes always carry complete
 * row values, so an update can safely replace an earlier update for the key. */
export function coalescePersistedTransactions(
  transactions: readonly PersistedTransaction[],
): PersistedTransaction {
  const latest = transactions.at(-1);
  if (latest === undefined) throw new Error("Cannot persist an empty SQLite checkpoint");

  const mutations = new Map<string, PersistedTransaction["mutations"][number]>();
  const rowMetadata = new Map<string, NonNullable<PersistedTransaction["rowMetadataMutations"]>[number]>();
  const collectionMetadata = new Map<string, NonNullable<PersistedTransaction["collectionMetadataMutations"]>[number]>();
  let truncate = false;

  for (const transaction of transactions) {
    if (transaction.truncate === true) {
      truncate = true;
      mutations.clear();
      rowMetadata.clear();
      collectionMetadata.clear();
    }
    for (const mutation of transaction.mutations) {
      mutations.set(storageKey(mutation.key), mutation);
    }
    for (const mutation of transaction.rowMetadataMutations ?? []) {
      rowMetadata.set(storageKey(mutation.key), mutation);
    }
    for (const mutation of transaction.collectionMetadataMutations ?? []) {
      collectionMetadata.set(mutation.key, mutation);
    }
  }

  return {
    txId: latest.txId,
    term: latest.term,
    seq: latest.seq,
    rowVersion: latest.rowVersion,
    ...(truncate ? { truncate: true } : {}),
    mutations: [...mutations.values()],
    ...(rowMetadata.size === 0 ? {} : { rowMetadataMutations: [...rowMetadata.values()] }),
    ...(collectionMetadata.size === 0 ? {} : { collectionMetadataMutations: [...collectionMetadata.values()] }),
  };
}

function storageKey(key: string | number): string {
  return `${typeof key}:${String(key)}`;
}
