import { useRouter } from "expo-router";
import { useContext, useState, type ReactElement } from "react";

import type { PullRequestKey } from "../data/forgeContract";
import { threadUnreadReader } from "../data/project-unread-model";
import type { ThreadId } from "../data/reviewContract";
import type { DeferReviewChatScenario } from "../features/pullRequestDetail/pullRequestScreenContract";
import type { ChangesView } from "../features/pullRequestDetail/pullRequestScreenModel";
import { useEvent } from "../react/useEvent";
import { useWorkspaceRouteResources } from "../services/workspace/workspaceRouteResources";
import { RecoverableRenderBoundary } from "../ui/RecoverableRenderBoundary";
import { useAndroidBackHandler } from "../ui/use-android-back-handler";
import { LinkedPullRequestChipProvider } from "./LinkedPullRequestChipProvider";
import { useLinkedThreadDescriptions } from "./linkedThreadDescriptions";
import { usePaneRearrangement } from "./paneMotion";
import { PullRequestDetailPane } from "./PullRequestDetailPane";
import { linkedThreadSelectionKey, usePullRequestNavigation } from "./pullRequestNavigation";
import { ThreadDestinationActiveContext } from "./threadDestinationActive";
import { WorkspaceCenterLayout } from "./WorkspaceCenterLayout";
import {
  useWorkspacePaneChrome,
  WorkspacePanesContext,
  type WorkspacePaneCapabilities,
} from "./workspacePanes";

/** The thread's own conversation declares no pane actions. */
const CONVERSATION_CAPABILITIES: WorkspacePaneCapabilities = {};

/** Which nested PR view the pane shows; it belongs to the pull request it was opened for. */
type PaneChanges = {
  readonly pullRequest: PullRequestKey | null;
  readonly view: ChangesView | null;
};

const DETAILS: PaneChanges = { pullRequest: null, view: null };

/**
 * Declares a thread route's panes: the conversation is the center pane and the pull request
 * opened from the composer's linked-PR chip is the right pane. The open pull request is the
 * thread route's `pullRequest` search param (set in place, like desktop Search's param, so the
 * mounted conversation is never replaced); Details and its nested Changes view are pane-local.
 * Back steps out of Changes, then closes the pane, before the thread's own Back.
 */
export function ThreadPullRequestPaneLayout({
  children,
  connectionId,
  pullRequest,
  threadId,
}: {
  /** The thread's conversation; it stays mounted while the pane opens and closes. */
  readonly children: ReactElement;
  readonly connectionId: string;
  /** The validated `pullRequest` search param, or `null` while no pane is open. */
  readonly pullRequest: PullRequestKey | null;
  readonly threadId: string;
}): React.JSX.Element {
  const active = useContext(ThreadDestinationActiveContext);
  const owner = useContext(WorkspacePanesContext)?.owner ?? null;
  const router = useRouter();
  const { desktop } = useWorkspaceRouteResources();
  const paneRearrangement = usePaneRearrangement();
  // Beside the chat the pane slides in and out; a phone covers the chat without moving panes.
  const rearrange = desktop ? paneRearrangement : applyImmediately;
  const [changes, setChanges] = useState<PaneChanges>(DETAILS);
  const changesView =
    pullRequest !== null && changes.pullRequest === pullRequest ? changes.view : null;
  const open = useEvent((next: PullRequestKey): void => {
    const show = (): void => {
      setChanges(DETAILS);
      router.setParams({ pullRequest: next });
    };
    if (pullRequest === null) {
      rearrange(show);
    } else {
      show();
    }
  });
  // The pane's declared close; the pane chrome already leaves its fullscreen and rearranges.
  const close = useEvent((): void => {
    setChanges(DETAILS);
    router.setParams({ pullRequest: undefined });
  });
  const openChanges = useEvent((view: ChangesView): void => {
    setChanges({ pullRequest, view });
  });
  const closeChanges = useEvent((): void => {
    setChanges(DETAILS);
  });
  const back = useEvent((): void => {
    if (changesView !== null) {
      closeChanges();
      return;
    }
    rearrange(() => {
      if (owner?.fullscreen$.peek() === "right") {
        owner.fullscreen$.set(null);
      }
      close();
    });
  });
  // The frame's Back-leaves-fullscreen subscribes later, so it still runs first.
  useAndroidBackHandler(pullRequest !== null, back);
  return (
    <LinkedPullRequestChipProvider
      connectionId={connectionId}
      onOpen={open}
      threadId={threadId}
      visiblePullRequest={pullRequest}
    >
      <WorkspaceCenterLayout
        active={active}
        center={{
          capabilities: CONVERSATION_CAPABILITIES,
          content: children,
          testID: "thread-primary-pane",
        }}
        right={
          pullRequest === null
            ? null
            : {
                capabilities: { close, fullscreen: true },
                content: (
                  <ThreadPullRequestPaneContent
                    changesView={changesView}
                    closeChanges={closeChanges}
                    connectionId={connectionId}
                    key={pullRequest}
                    openChanges={openChanges}
                    pullRequest={pullRequest}
                    threadId={threadId}
                  />
                ),
                testID: desktop ? "thread-pull-request-pane" : "thread-compact-pull-request",
              }
        }
        testID="thread-workspace"
      />
    </LinkedPullRequestChipProvider>
  );
}

/**
 * The PR detail in the thread's right pane. Its Back is the pane's close; a review chat that is
 * this thread closes the pane back to it, and any other chat or a PR without one leaves for the
 * existing route that hosts it.
 */
function ThreadPullRequestPaneContent({
  changesView,
  closeChanges,
  connectionId,
  openChanges,
  pullRequest,
  threadId,
}: {
  readonly changesView: ChangesView | null;
  readonly closeChanges: () => void;
  readonly connectionId: string;
  readonly openChanges: (view: ChangesView) => void;
  readonly pullRequest: PullRequestKey;
  readonly threadId: string;
}): React.JSX.Element {
  const chrome = useWorkspacePaneChrome();
  const { desktop, list, runtime } = useWorkspaceRouteResources();
  const describeLinkedThread = useLinkedThreadDescriptions(list.loadedThreadSummaries);
  const navigation = usePullRequestNavigation();
  const back = useEvent((): void => {
    chrome.close?.();
  });
  const openThread = useEvent((target: ThreadId): void => {
    if (target === threadId) {
      chrome.close?.();
      return;
    }
    list.prepareThreadLink(linkedThreadSelectionKey(connectionId, target));
    navigation.navigateToLinkedThread(connectionId, target);
  });
  // The review-chat draft lives on the PR route, which owns its project choice and first send.
  const openPullRequest = useEvent((): void => {
    navigation.openPullRequest(connectionId, pullRequest);
  });
  const openReviewChat = useEvent((reviewThread: ThreadId | null): void => {
    if (reviewThread === null) {
      openPullRequest();
    } else {
      openThread(reviewThread);
    }
  });
  // The scenario continues on the PR route; this pane settles it as dismissed.
  const deferReviewChatScenario = useEvent<DeferReviewChatScenario>(
    async () =>
      new Promise<ThreadId | null>((resolve) => {
        openPullRequest();
        resolve(null);
      }),
  );
  return (
    <RecoverableRenderBoundary label="Pull request" resetKey={pullRequest} scope="surface">
      <PullRequestDetailPane
        connectionId={connectionId}
        describeThread={(linked) => describeLinkedThread(connectionId, linked)}
        desktop={desktop}
        initialChangesView={changesView ?? "files"}
        isThreadUnread={threadUnreadReader(
          runtime.threadSummaries?.projectUnread ?? null,
          connectionId,
        )}
        navigation={{
          back,
          chatVisible: false,
          closeChanges,
          deferReviewChatScenario,
          openChanges,
          openReviewChat,
          openThread,
        }}
        pullRequest={pullRequest}
        tab={changesView === null ? "overview" : "changes"}
      />
    </RecoverableRenderBoundary>
  );
}

function applyImmediately(change: () => void): void {
  change();
}
