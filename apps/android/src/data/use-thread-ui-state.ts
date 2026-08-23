import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { use } from "react";

import type { ThreadUiStateDatabase } from "./thread-ui-state-database";
import type { ThreadUiStateRow } from "./thread-ui-state-types";

/**
 * Reads the persisted semantic anchor before constructing the chat window.
 * The stable database resource suspends the nearest conversation boundary;
 * the live query only keeps the already revealed composer row current.
 */
export function useThreadUiState(
  database: ThreadUiStateDatabase,
  connectionId: string,
  threadId: string,
): ThreadUiStateRow {
  const initial = use(database.read(connectionId, threadId));
  const query = useLiveQuery(
    (builder) => builder
      .from({ state: database.collection })
      .where(({ state }) => and(
        eq(state.connectionId, connectionId),
        eq(state.threadId, threadId),
      )),
    [connectionId, database, threadId],
  );
  return query.data?.[0] ?? initial;
}
