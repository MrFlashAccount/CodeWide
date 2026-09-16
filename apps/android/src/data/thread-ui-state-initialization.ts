import type { ThreadUiStateDatabase } from "./thread-ui-state-database-contract";

/** Seed access shared by draft, attachment, preferences and timeline readers. */
export type ThreadUiStateSeedDatabase = Pick<ThreadUiStateDatabase, "get" | "getOrCreate">;

// The existing application module owns one pending operation per qualified thread.
// Feature activation and native boot stop never clear this map.
const threadUiStateSeedInFlight = new Map<
  string,
  ReturnType<ThreadUiStateDatabase["getOrCreate"]>
>();

/** Reuse the shared pending seed and clear only the completing operation. */
export async function getOrCreateThreadUiState(
  connectionId: string,
  threadId: string,
  database: ThreadUiStateSeedDatabase | null,
) {
  if (database === null) {
    throw new Error("Local thread UI state is not ready");
  }
  const uiState = database;
  const cached = uiState.get(connectionId, threadId);
  if (cached !== null) {
    return cached;
  }
  const key = `${connectionId}\u0000${threadId}`;
  const pending = threadUiStateSeedInFlight.get(key);
  if (pending !== undefined) {
    return pending;
  }
  const operation = uiState.getOrCreate(connectionId, threadId);
  threadUiStateSeedInFlight.set(key, operation);
  try {
    return await operation;
  } finally {
    if (threadUiStateSeedInFlight.get(key) === operation) {
      threadUiStateSeedInFlight.delete(key);
    }
  }
}
