import {
  parseMessageSearchPage,
  parseSearchConversationPage,
  type MessageSearchPage,
  type MessageSearchQuery,
  type SearchContextQuery,
  type SearchConversationPage,
} from "../../data/message-search";
import type { PendingRequestDatabase } from "../../data/pending-request-database";
import { projectThreadHotStates } from "../../data/thread-hot-state";
import type { ThreadSummaryDatabase } from "../../data/thread-summary-database";
import type { WorkspaceSyncSession, createWorkspaceSession } from "../../data/workspace-session";

import type { SearchWorkspaceCapabilities } from "./workspaceCapabilities";
/** Converts search intents using retained lower authorities. */
export function createSearchWorkspaceAdapter({
  getSummaries,
  getPendingRequests,
  getSession,
  rpcAfterAttach,
}: {
  getSummaries(): ThreadSummaryDatabase | null;
  getPendingRequests(): PendingRequestDatabase | null;
  getSession(connectionId: string): WorkspaceSyncSession | undefined;
  rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
}): SearchWorkspaceCapabilities {
  const searchThreads = async (query: string, connectionId: string | null = null) => {
    return projectThreadHotStates(
      (await getSummaries()?.search(query, connectionId)) ?? [],
      getPendingRequests()?.collection.toArray ?? [],
    );
  };

  const searchMessages = async (
    connectionId: string,
    query: MessageSearchQuery,
  ): Promise<MessageSearchPage> => {
    const session = getSession(connectionId);
    if (session === undefined) throw new Error("Connection is not enabled");
    return parseMessageSearchPage(await rpcAfterAttach(session, "companion/search", query));
  };

  const searchConversation = async (
    connectionId: string,
    query: SearchContextQuery,
  ): Promise<SearchConversationPage> => {
    const session = getSession(connectionId);
    if (session === undefined) throw new Error("Connection is not enabled");
    return parseSearchConversationPage(
      await rpcAfterAttach(session, "companion/search/window", query),
    );
  };
  return { searchThreads, searchMessages, searchConversation };
}
