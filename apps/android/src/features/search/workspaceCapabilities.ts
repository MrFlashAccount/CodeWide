import type {
  MessageSearchPage,
  MessageSearchQuery,
  SearchContextQuery,
  SearchConversationPage,
} from "../../data/message-search";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
/** Qualified search operations; transport and persisted state stay with their existing lower owners. */
export type SearchWorkspaceCapabilities = {
  searchThreads(query: string, connectionId?: string | null): Promise<StoredThreadSummary[]>;
  searchMessages(connectionId: string, query: MessageSearchQuery): Promise<MessageSearchPage>;
  searchConversation(
    connectionId: string,
    query: SearchContextQuery,
  ): Promise<SearchConversationPage>;
};
