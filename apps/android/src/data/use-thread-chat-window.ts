import { useSelector } from "@legendapp/state/react";
import { useSyncExternalStore } from "react";

import type { ThreadDetailDatabase } from "./thread-detail-database";
import type { ThreadChatWindowRequest, ThreadChatWindowSnapshot } from "./thread-chat-model";

export type ThreadChatWindowView = {
  detailRows: ReturnType<ThreadDetailDatabase["readWindowRows"]>["detailRows"];
  liveRows: ReturnType<ThreadDetailDatabase["readWindowRows"]>["liveRows"];
  snapshot: ThreadChatWindowSnapshot;
  turnRows: ReturnType<ThreadDetailDatabase["readWindowRows"]>["turnRows"];
};

function useThreadChatWindowResource(
  database: ThreadDetailDatabase | null,
  input: ThreadChatWindowRequest | null,
  suspendUntilReady: boolean,
): ReturnType<ThreadDetailDatabase["windowResource"]> | null {
  const resource = database === null || input === null ? null : database.windowResource(input);
  useSyncExternalStore(
    resource?.retain ?? emptyRetain,
    resource?.retentionSnapshot ?? emptyRetentionSnapshot,
    emptyRetentionSnapshot,
  );
  useSelector(() => (resource === null ? true : resource.ready$.get()), {
    suspense: suspendUntilReady,
  });
  return resource;
}

function emptyRetain(): () => void {
  return () => undefined;
}

function emptyRetentionSnapshot(): number {
  return 0;
}

export function useThreadChatWindow(
  database: ThreadDetailDatabase | null,
  input: ThreadChatWindowRequest | null,
  mode: "deferred" | "progressive" | "suspend" = "suspend",
): ThreadChatWindowView | null {
  useThreadChatWindowResource(database, mode === "deferred" ? null : input, mode === "suspend");
  const snapshot = useSelector(() => {
    if (database === null || input === null) {
      return null;
    }
    const node = database.chat.window$(input.connectionId, input.threadId);
    const layoutRevision = node.layoutRevision.get();
    const revision = node.revision.get();
    const status = node.status.get();
    const error = node.error.get();
    const installedRequestKey = node.installedRequestKey.get();
    return { ...node.peek(), error, installedRequestKey, layoutRevision, revision, status };
  });

  if (database === null || snapshot === null) {
    return null;
  }
  return { snapshot, ...database.readWindowRows(snapshot) };
}
