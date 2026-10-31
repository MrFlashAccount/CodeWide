import { PullRequestConversationPane } from "./PullRequestConversationPane";
import { PullRequestReviewChatDraftPane } from "./PullRequestReviewChatDraftPane";
import type { PullRequestChatState, ReviewChatDraftCommands } from "./usePullRequestReviewChat";

/**
 * The right pane's content: the review-chat draft of a PR without a chat, or its canonical
 * conversation. Its header reads the right pane's close and fullscreen from `ThreePanelsContext`.
 */
export function PullRequestReviewChatPane({
  chat,
  connectionId,
  draft,
}: {
  readonly chat: Exclude<PullRequestChatState, { readonly status: "closed" }>;
  readonly connectionId: string;
  readonly draft: ReviewChatDraftCommands;
}): React.JSX.Element {
  return chat.status === "draft" ? (
    <PullRequestReviewChatDraftPane
      commands={draft}
      connectionId={connectionId}
      draft={chat.draft}
    />
  ) : (
    <PullRequestConversationPane connectionId={connectionId} threadId={chat.threadId} />
  );
}
