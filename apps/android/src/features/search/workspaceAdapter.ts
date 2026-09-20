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
import type { GlobalSupervisorVisibilityPolicy } from "../../data/globalSupervisorVisibility";

import type { SearchWorkspaceCapabilities } from "./workspaceCapabilities";
/** Converts search intents using retained lower authorities. */
export function createSearchWorkspaceAdapter({
  getPendingRequests,
  getSession,
  getSummaries,
  getVisibility,
  rpcAfterAttach,
}: {
  getPendingRequests: () => PendingRequestDatabase | null;
  getSession: (connectionId: string) => WorkspaceSyncSession | undefined;
  getSummaries: () => ThreadSummaryDatabase | null;
  getVisibility: () => GlobalSupervisorVisibilityPolicy | null;
  rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
}): SearchWorkspaceCapabilities {
  const searchThreads = async (query: string, connectionId: string | null = null) =>
    projectThreadHotStates(
      (await getSummaries()?.search(query, connectionId)) ?? [],
      getPendingRequests()?.collection.toArray ?? [],
    );

  const searchMessages = async (
    connectionId: string,
    query: MessageSearchQuery,
  ): Promise<MessageSearchPage> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    const visibility = getVisibility();
    if (visibility === null) {
      throw new Error("Supervisor visibility policy is not ready");
    }
    const page = parseMessageSearchPage(await rpcAfterAttach(session, "companion/search", query));
    return {
      ...page,
      data: page.data.filter((hit) => visibility.allowsOrdinaryRef(connectionId, hit.threadId)),
    };
  };

  const searchConversation = async (
    connectionId: string,
    query: SearchContextQuery,
  ): Promise<SearchConversationPage> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    const visibility = getVisibility();
    if (visibility === null) {
      throw new Error("Supervisor visibility policy is not ready");
    }
    if (!visibility.allowsOrdinaryRef(connectionId, query.threadId)) {
      throw new Error("The requested chat is not available in ordinary search");
    }
    return parseSearchConversationPage(
      await rpcAfterAttach(session, "companion/search/window", query),
    );
  };
  return { searchConversation, searchMessages, searchThreads };
}
