import type {
  MessageSearchPage,
  MessageSearchQuery,
} from "../../data/message-search";

/** Search requests retain the existing validated lower read authority. */
export type MessageSearchCapability = {
  searchMessages(connectionId: string, query: MessageSearchQuery): Promise<MessageSearchPage>;
};
