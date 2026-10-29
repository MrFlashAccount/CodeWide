import type { PullRequestKey } from "../data/forgeContract";
import { PullRequestConversationPane } from "./PullRequestConversationPane";
import { PullRequestReviewChatDraftPane } from "./PullRequestReviewChatDraftPane";
import type { PullRequestChatState, ReviewChatDraftCommands } from "./usePullRequestReviewChat";
import { useWorkspacePaneChrome } from "./workspacePanes";

/**
 * The right pane's content: the review-chat draft of a PR without a chat, or its canonical
 * conversation. Its close and menu items are the right pane's declared actions, resolved by the
 * pane layout.
 */
export function PullRequestReviewChatPane({
  chat,
  connectionId,
  draft,
  pullRequest,
}: {
  readonly chat: Exclude<PullRequestChatState, { readonly status: "closed" }>;
  readonly connectionId: string;
  readonly draft: ReviewChatDraftCommands;
  readonly pullRequest: PullRequestKey;
}): React.JSX.Element {
  const chrome = useWorkspacePaneChrome();
  return chat.status === "draft" ? (
    <PullRequestReviewChatDraftPane
      chrome={chrome}
      commands={draft}
      connectionId={connectionId}
      draft={chat.draft}
    />
  ) : (
    <PullRequestConversationPane
      chrome={chrome}
      connectionId={connectionId}
      pullRequest={pullRequest}
      threadId={chat.threadId}
    />
  );
}
