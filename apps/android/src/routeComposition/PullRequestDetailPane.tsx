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
import { useThreePanels } from "../ui/threePanels";

export type PullRequestDetailPaneProps = {
  readonly connectionId: string;
  readonly describeThread: PullRequestScreenProps["describeThread"];
  readonly desktop: boolean;
  readonly initialChangesView: PullRequestScreenProps["initialChangesView"];
  readonly isThreadUnread: PullRequestScreenProps["isThreadUnread"];
  readonly navigation: PullRequestScreenProps["navigation"];
  readonly pullRequest: PullRequestScreenProps["pullRequest"];
  readonly tab: PullRequestTab;
};

/**
 * Renders the route-owned PR detail as the content of whichever pane places it. The screen is
 * position-agnostic: its header reads close, Back and fullscreen from `ThreePanelsContext`, and it
 * paints no surface of its own. Opening a chat from a fullscreen PR leaves fullscreen so the chat
 * can appear beside it.
 */
export function PullRequestDetailPane(props: PullRequestDetailPaneProps): React.JSX.Element {
  const { chrome } = useThreePanels();
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
          openReviewChat,
          openThread,
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
