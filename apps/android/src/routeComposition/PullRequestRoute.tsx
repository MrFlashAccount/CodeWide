import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";

import { parsePullRequestKeyParam, type PullRequestKey } from "../data/forgeContract";
import { threadUnreadReader } from "../data/project-unread-model";
import type {
  ChangesView,
  PullRequestTab,
} from "../features/pullRequestDetail/pullRequestScreenModel";
import { workspaceFeatures } from "../features/workspace/createWorkspaceFeatures";
import { useEvent } from "../react/useEvent";
import { useWorkspaceRouteResources } from "../services/workspace/workspaceRouteResources";
import { RecoverableRenderBoundary } from "../ui/RecoverableRenderBoundary";
import { useLinkedThreadDescriptions } from "./linkedThreadDescriptions";
import { PullRequestDetailPane } from "./PullRequestDetailPane";
import { PullRequestReviewChatPane } from "./PullRequestReviewChatPane";
import { usePullRequestReviewChat } from "./usePullRequestReviewChat";
import { WorkspaceCenterLayout } from "./WorkspaceCenterLayout";
import type { WorkspacePaneCapabilities } from "./workspacePanes";

/** The PR center pane can be shown alone. */
const PULL_REQUEST_CAPABILITIES: WorkspacePaneCapabilities = {
  fullscreen: true,
};

/** PR destination that validates Router params before mounting one identity-owned lifecycle. */
export function PullRequestRoute({
  tab,
}: {
  readonly tab: PullRequestTab;
}): React.JSX.Element | null {
  const params = useLocalSearchParams<{
    connectionId?: string;
    pullRequestKey?: string;
    view?: string;
  }>();
  const connectionId = typeof params.connectionId === "string" ? params.connectionId : null;
  const pullRequest = parsePullRequestKeyParam(params.pullRequestKey);
  if (connectionId === null || pullRequest === null) {
    return null;
  }
  return (
    <PullRequestRouteContent
      connectionId={connectionId}
      key={`${connectionId}:${pullRequest}`}
      pullRequest={pullRequest}
      tab={tab}
      view={params.view === "guide" ? "guide" : "files"}
    />
  );
}

/**
 * Declares the PR route's panes: the PR is the center pane and the review chat the right pane.
 * The shared pane layout owns their placement, radii, fullscreen and chrome.
 */
function PullRequestRouteContent({
  connectionId,
  pullRequest,
  tab,
  view,
}: {
  readonly connectionId: string;
  readonly pullRequest: PullRequestKey;
  readonly tab: PullRequestTab;
  /** What the Changes route opens on; from its `view` search param. */
  readonly view: ChangesView;
}): React.JSX.Element {
  const routeActive = useIsFocused();
  const router = useRouter();
  const { desktop, list, runtime } = useWorkspaceRouteResources();
  const describeLinkedThread = useLinkedThreadDescriptions(list.loadedThreadSummaries);
  const reviewChat = usePullRequestReviewChat({
    connectionId,
    desktop,
    ensureReviewChat: workspaceFeatures.pullRequestDetail.ensureReviewChat,
    prepareThreadLink: list.prepareThreadLink,
    pullRequest,
    routeActive,
    sendText: workspaceFeatures.composer.sendText,
  });
  const back = useEvent((): void => {
    router.dismissTo("/pulls");
  });
  // Changes is a nested route pushed over Details, so Back returns to Details.
  const openChanges = useEvent((nextView: ChangesView): void => {
    router.push({
      params: { connectionId, pullRequestKey: pullRequest, view: nextView },
      pathname: "/pulls/[connectionId]/[pullRequestKey]/changes",
    });
  });
  const closeChanges = useEvent((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    // A deep link opened Changes alone; Details takes its place.
    router.replace({
      params: { connectionId, pullRequestKey: pullRequest },
      pathname: "/pulls/[connectionId]/[pullRequestKey]",
    });
  });
  const chat = reviewChat.chat;
  return (
    <RecoverableRenderBoundary
      label="Pull request"
      resetKey={`${connectionId}:${pullRequest}`}
      scope="surface"
    >
      <WorkspaceCenterLayout
        active={routeActive}
        center={{
          capabilities: PULL_REQUEST_CAPABILITIES,
          content: (
            <PullRequestDetailPane
              connectionId={connectionId}
              describeThread={(threadId) => describeLinkedThread(connectionId, threadId)}
              desktop={desktop}
              initialChangesView={view}
              isThreadUnread={threadUnreadReader(
                runtime.threadSummaries?.projectUnread ?? null,
                connectionId,
              )}
              navigation={{
                // A wide PR sits beside its catalog, so Details has nothing behind it.
                back: desktop ? null : back,
                closeChanges,
                deferReviewChatScenario: reviewChat.deferScenario,
                openChanges,
                openReviewChat: reviewChat.openReviewChat,
                openThread: reviewChat.openThread,
              }}
              pullRequest={pullRequest}
              tab={tab}
            />
          ),
          label: "pull request",
          shows: { connectionId, kind: "pullRequest", pullRequest },
          testID: "pull-request-primary-pane",
        }}
        right={
          chat.status === "closed"
            ? null
            : {
                capabilities: {
                  close: reviewChat.dismissChat,
                  fullscreen: true,
                },
                content: (
                  <PullRequestReviewChatPane
                    chat={chat}
                    connectionId={connectionId}
                    draft={reviewChat.draft}
                  />
                ),
                label: "review chat",
                shows: {
                  connectionId,
                  kind: "conversation",
                  threadId: chat.status === "open" ? chat.threadId : null,
                },
                testID: desktop ? "pull-request-chat-pane" : "pull-request-compact-chat",
              }
        }
        testID="pull-request-workspace"
      />
    </RecoverableRenderBoundary>
  );
}
