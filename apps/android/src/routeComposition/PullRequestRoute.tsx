import { useReviewChatPlacement, reviewChatRouteOptions } from "./reviewChatPlacement";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";

import { parsePullRequestKeyParam, type PullRequestKey } from "../data/forgeContract";
import { threadUnreadReader } from "../data/project-unread-model";
import type {
  ChangesView,
  PullRequestTab,
} from "../features/pullRequestDetail/pullRequestScreenModel";
import { workspaceFeatures } from "../features/workspace/createWorkspaceFeatures";
import { useEvent } from "../react/useEvent";
import { useAndroidBackHandler } from "../ui/use-android-back-handler";
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
    catalogPullRequestKey?: string;
    composeReview?: string;
    connectionId?: string;
    fromChat?: string;
    link?: string;
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
      catalogPullRequest={parsePullRequestKeyParam(params.catalogPullRequestKey)}
      composeReview={params.composeReview ?? ""}
      connectionId={connectionId}
      fromChat={params.fromChat === "1"}
      key={`${connectionId}:${pullRequest}`}
      link={typeof params.link === "string" ? params.link : null}
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
  catalogPullRequest,
  composeReview,
  connectionId,
  fromChat,
  link,
  pullRequest,
  tab,
  view,
}: {
  readonly catalogPullRequest: PullRequestKey | null;
  readonly composeReview: string;
  readonly connectionId: string;
  readonly fromChat: boolean;
  readonly link: string | null;
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
    ...reviewChatRouteOptions(composeReview, { connectionId, pullRequest }),
    connectionId,
    desktop,
    ensureReviewChat: workspaceFeatures.pullRequestDetail.ensureReviewChat,
    prepareThreadLink: list.prepareThreadLink,
    pullRequest,
    routeActive,
    sendText: workspaceFeatures.composer.sendText,
  });
  const placement = useReviewChatPlacement({
    active: routeActive,
    connectionId,
    fromChat,
    link,
    openChat: reviewChat.openReviewChat,
    openDraft: reviewChat.openAttachedDraft,
    prepareThread: list.prepareThreadLink,
    pullRequest,
    servers: list.settingsConnections,
  });
  const back = useEvent((): void => {
    if (fromChat && router.canGoBack()) {
      router.back();
    } else {
      router.dismissTo("/pulls");
    }
  });
  // Changes is a nested route pushed over Details, so Back returns to Details.
  const prParams = {
    ...(catalogPullRequest === null ? {} : { catalogPullRequestKey: catalogPullRequest }),
    connectionId,
    pullRequestKey: pullRequest,
  };
  const pushChanges = useEvent((nextView: ChangesView): void => {
    router.push({
      params: { ...prParams, view: nextView },
      pathname: "/pulls/[connectionId]/[pullRequestKey]/changes",
    });
  });
  const popChanges = useEvent((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    // A deep link opened Changes alone; Details takes its place.
    router.replace({
      params: prParams,
      pathname: "/pulls/[connectionId]/[pullRequestKey]",
    });
  });
  const changes = usePaneChanges({ desktop, popChanges, pushChanges, tab, view });
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
              initialChangesView={changes.view}
              isThreadUnread={threadUnreadReader(
                runtime.threadSummaries?.projectUnread ?? null,
                connectionId,
              )}
              navigation={{
                back,
                closeChanges: changes.close,
                deferReviewChatScenario: reviewChat.deferScenario,
                openChanges: changes.open,
                openReviewChat: placement.open,
                openThread: reviewChat.openThread,
              }}
              openAttachedDraft={reviewChat.openAttachedDraft}
              pullRequest={pullRequest}
              tab={changes.tab}
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
                    pullRequest={pullRequest}
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
      {placement.picker}
    </RecoverableRenderBoundary>
  );
}

/**
 * Changes shown inside a wide Details pane, so the review chat beside it stays and the panes keep
 * their arrangement; a phone, or the Changes route itself, navigates with `pushChanges` and
 * `popChanges` instead. Android Back returns from pane Changes to Details first.
 */
function usePaneChanges({
  desktop,
  popChanges,
  pushChanges,
  tab,
  view,
}: {
  readonly desktop: boolean;
  readonly popChanges: () => void;
  readonly pushChanges: (view: ChangesView) => void;
  readonly tab: PullRequestTab;
  /** The view the Changes route opens on. */
  readonly view: ChangesView;
}): {
  readonly close: () => void;
  readonly open: (view: ChangesView) => void;
  readonly tab: PullRequestTab;
  readonly view: ChangesView;
} {
  const [paneView, setPaneView] = useState<ChangesView | null>(null);
  const inPane = desktop && tab === "overview";
  const open = useEvent((next: ChangesView): void => {
    if (inPane) {
      setPaneView(next);
    } else {
      pushChanges(next);
    }
  });
  const close = useEvent((): void => {
    if (paneView === null) {
      popChanges();
    } else {
      setPaneView(null);
    }
  });
  const back = useEvent((): void => {
    setPaneView(null);
  });
  useAndroidBackHandler(paneView !== null, back);
  return paneView === null
    ? { close, open, tab, view }
    : { close, open, tab: "changes", view: paneView };
}
