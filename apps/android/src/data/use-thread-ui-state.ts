import { useSelector } from "@legendapp/state/react";
import { useEffect } from "react";

import { useAsyncResource, type AsyncResourceSnapshot } from "../rendering/async-resource-store";
import type { ThreadUiStateDatabase } from "./thread-ui-state-database";
import type { ThreadUiStateRow } from "./thread-ui-state-types";

export type ThreadUiStateRead =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly value: ThreadUiStateRow };

type ThreadUiStateLoadResult =
  | { readonly error: Error; readonly status: "error" }
  | { readonly status: "ready"; readonly value: ThreadUiStateRow };

const LOADING_THREAD_UI_STATE: ThreadUiStateRead = { status: "loading" };
const databaseIds = new WeakMap<ThreadUiStateDatabase, number>();
let nextDatabaseId = 0;

/**
 * Starts the persisted UI-state resource during render without suspending the
 * conversation frame. The editor stays unavailable until the ready projection
 * is published; the key-scoped Legend row keeps it current afterwards.
 */
export function useThreadUiState(
  database: ThreadUiStateDatabase,
  connectionId: string,
  threadId: string,
): ThreadUiStateRead {
  useEffect(() => database.retain(connectionId, threadId), [connectionId, database, threadId]);
  const resident = database.get(connectionId, threadId);
  const resource = useAsyncResource<ThreadUiStateLoadResult>(
    resident === null
      ? `thread-ui-state:${String(databaseId(database))}:${connectionId}\u0000${threadId}`
      : null,
    0,
    async () => loadThreadUiState(database, connectionId, threadId),
  );
  const current = useSelector(() => database.row$(connectionId, threadId).get());
  return threadUiStateRead(current ?? resident, resource);
}

async function loadThreadUiState(
  database: ThreadUiStateDatabase,
  connectionId: string,
  threadId: string,
): Promise<ThreadUiStateLoadResult> {
  try {
    return { status: "ready", value: await database.read(connectionId, threadId) };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error : new Error("Could not restore the conversation editor"),
      status: "error",
    };
  }
}

function threadUiStateRead(
  resident: ThreadUiStateRow | null,
  resource: AsyncResourceSnapshot<ThreadUiStateLoadResult>,
): ThreadUiStateRead {
  const value = resident ?? readyResourceValue(resource.value);
  if (value !== null) {
    return { status: "ready", value };
  }
  if (resource.value?.status === "error") {
    throw resource.value.error;
  }
  if (resource.status === "error") {
    throw new Error(resource.error ?? "Could not restore the conversation editor");
  }
  return LOADING_THREAD_UI_STATE;
}

function readyResourceValue(result: ThreadUiStateLoadResult | null): ThreadUiStateRow | null {
  return result?.status === "ready" ? result.value : null;
}

function databaseId(database: ThreadUiStateDatabase): number {
  const existing = databaseIds.get(database);
  if (existing !== undefined) {
    return existing;
  }
  nextDatabaseId += 1;
  databaseIds.set(database, nextDatabaseId);
  return nextDatabaseId;
}
