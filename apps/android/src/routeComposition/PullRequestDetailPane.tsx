import { Suspense } from "react";

import type { ThreadId } from "../data/reviewContract";
import {
  forgeResources,
  pullRequestCommentDestinations,
  reviewResources,
} from "../data/forgeRuntime";
import { PullRequestScreen } from "../features/pullRequestDetail/PullRequestScreen";
import { PullRequestScreenSkeleton } from "../features/pullRequestDetail/PullRequestScreenSkeleton";
import type { PullRequestScreenProps } from "../features/pullRequestDetail/pullRequestScreenContract";
import type { PullRequestTab } from "../features/pullRequestDetail/pullRequestScreenModel";
import { workspaceFeatures } from "../features/workspace/createWorkspaceFeatures";
import { useEvent } from "../react/useEvent";
import { useWorkspacePaneChrome } from "./workspacePanes";

type PullRequestPaneNavigation = Omit<
  PullRequestScreenProps["navigation"],
  "openPullRequestFullscreen" | "pullRequestFullscreen"
>;

export type PullRequestDetailPaneProps = {
  readonly connectionId: string;
  readonly describeThread: PullRequestScreenProps["describeThread"];
  readonly desktop: boolean;
  readonly initialChangesView: PullRequestScreenProps["initialChangesView"];
  readonly isThreadUnread: PullRequestScreenProps["isThreadUnread"];
  readonly navigation: PullRequestPaneNavigation;
  readonly pullRequest: PullRequestScreenProps["pullRequest"];
  readonly tab: PullRequestTab;
};

/**
 * Renders the route-owned PR detail as the center pane's content. Its fullscreen control is the
 * center pane's declared fullscreen action; opening a chat from a fullscreen PR leaves fullscreen
 * so the chat can appear beside it.
 */
export function PullRequestDetailPane(props: PullRequestDetailPaneProps): React.JSX.Element {
  const chrome = useWorkspacePaneChrome();
  const leaveFullscreen = (): void => {
    if (chrome.fullscreen) {
      chrome.toggleFullscreen?.();
    }
  };
  const openReviewChat = useEvent((reviewThread: ThreadId | null): void => {
    leaveFullscreen();
    props.navigation.openReviewChat(reviewThread);
  });
  const openThread = useEvent((threadId: ThreadId): void => {
    leaveFullscreen();
    props.navigation.openThread(threadId);
  });
  return (
    <Suspense fallback={<PullRequestScreenSkeleton />}>
      <PullRequestScreen
        capabilities={workspaceFeatures.pullRequestDetail}
        commentDestinations={pullRequestCommentDestinations}
        connectionId={props.connectionId}
        describeThread={props.describeThread}
        forge={forgeResources}
        initialChangesView={props.initialChangesView}
        isThreadUnread={props.isThreadUnread}
        navigation={{
          ...props.navigation,
          openPullRequestFullscreen: chrome.toggleFullscreen,
          openReviewChat,
          openThread,
          pullRequestFullscreen: chrome.fullscreen,
        }}
        pullRequest={props.pullRequest}
        review={reviewResources}
        reviewCapabilities={workspaceFeatures.reviewTarget}
        tab={props.tab}
        tablet={props.desktop}
      />
    </Suspense>
  );
}
