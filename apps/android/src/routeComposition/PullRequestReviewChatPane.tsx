import { useState } from "react";

import { useEvent } from "../react/useEvent";
import { LocalProjectManagement } from "./LocalProjectManagement";
import { CLOSED_PROJECT_MANAGEMENT, OPEN_PROJECT_MANAGEMENT } from "./localProjectManagementPage";
import { PullRequestConversationPane } from "./PullRequestConversationPane";
import { PullRequestReviewChatDraftPane } from "./PullRequestReviewChatDraftPane";
import type { PullRequestChatState, ReviewChatDraftCommands } from "./usePullRequestReviewChat";

/**
 * The right pane's content: the review-chat draft of a PR without a chat, or its canonical
 * conversation. Its header reads the right pane's close and fullscreen from `ThreePanelsContext`.
 * Manage projects opens here, over the mounted PR route: `/projects` belongs to the Threads tab,
 * so navigating to it would leave Pull requests.
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
  const [projects, setProjects] = useState(CLOSED_PROJECT_MANAGEMENT);
  const manageProjects = useEvent((): void => {
    setProjects(OPEN_PROJECT_MANAGEMENT);
  });
  return (
    <>
      {chat.status === "draft" ? (
        <PullRequestReviewChatDraftPane
          commands={draft}
          connectionId={connectionId}
          draft={chat.draft}
          onManageProjects={manageProjects}
        />
      ) : (
        <PullRequestConversationPane
          connectionId={connectionId}
          onManageProjects={manageProjects}
          threadId={chat.threadId}
        />
      )}
      <LocalProjectManagement onNavigate={setProjects} page={projects} />
    </>
  );
}
