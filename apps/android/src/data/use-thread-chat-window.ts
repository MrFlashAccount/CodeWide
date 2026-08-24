import { useSelector } from "@legendapp/state/react";
import { useEffect } from "react";

import type { ThreadDetailDatabase } from "./thread-detail-database";
import type { ThreadChatWindowRequest, ThreadChatWindowSnapshot } from "./thread-chat-model";

export type ThreadChatWindowView = {
  snapshot: ThreadChatWindowSnapshot;
  turnRows: ReturnType<ThreadDetailDatabase["readWindowRows"]>["turnRows"];
  detailRows: ReturnType<ThreadDetailDatabase["readWindowRows"]>["detailRows"];
  liveRows: ReturnType<ThreadDetailDatabase["readWindowRows"]>["liveRows"];
};

function useThreadChatWindowResource(
  database: ThreadDetailDatabase | null,
  input: ThreadChatWindowRequest | null,
): ReturnType<ThreadDetailDatabase["windowResource"]> | null {
  const enabled = input !== null;
  const connectionId = input?.connectionId ?? "";
  const threadId = input?.threadId ?? "";
  const anchorTurnId = input?.anchorTurnId ?? null;
  useEffect(() => {
    if (database === null || !enabled) return;
    return database.retainWindow(connectionId, threadId);
  }, [connectionId, database, enabled, threadId]);
  useEffect(() => {
    if (database === null || !enabled) return;
    database.adoptPreloadedWindow(connectionId, threadId);
  }, [anchorTurnId, connectionId, database, enabled, threadId]);
  const resource = database === null || !enabled ? null : database.windowResource({
      connectionId,
      threadId,
      anchorTurnId,
    });
  useSelector(() => resource === null ? true : resource.ready$.get(), { suspense: true });
  return resource;
}

export function useThreadChatWindow(
  database: ThreadDetailDatabase | null,
  input: ThreadChatWindowRequest | null,
): ThreadChatWindowView | null {
  useThreadChatWindowResource(database, input);
  const enabled = input !== null;
  const connectionId = input?.connectionId ?? "";
  const threadId = input?.threadId ?? "";
  const snapshot = useSelector(() => {
    if (database === null || !enabled) return null;
    const node = database.chat.window$(connectionId, threadId);
    const layoutRevision = node.layoutRevision.get();
    const revision = node.revision.get();
    return { ...node.peek(), layoutRevision, revision };
  });

  if (database === null || snapshot === null) return null;
  return { snapshot, ...database.readWindowRows(snapshot) };
}
