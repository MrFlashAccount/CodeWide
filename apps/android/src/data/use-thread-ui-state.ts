import { useSelector } from "@legendapp/state/react";
import { use } from "react";

import type { ThreadUiStateDatabase } from "./thread-ui-state-database";
import type { ThreadUiStateRow } from "./thread-ui-state-types";

/**
 * Reads the persisted semantic anchor before constructing the chat window.
 * The stable database resource suspends the nearest conversation boundary;
 * the key-scoped Legend row keeps only this composer current afterwards.
 */
export function useThreadUiState(
  database: ThreadUiStateDatabase,
  connectionId: string,
  threadId: string,
): ThreadUiStateRow {
  const initial = use(database.read(connectionId, threadId));
  return useSelector(() => database.row$(connectionId, threadId).get()) ?? initial;
}
