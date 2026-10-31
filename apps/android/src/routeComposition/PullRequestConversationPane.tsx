import { useRouter } from "expo-router";

import type { PullRequestKey } from "../data/forgeContract";
import { workspaceRuntime } from "../data/workspace-runtime";
import type { ThreadId } from "../data/reviewContract";
import { ActiveWorkspaceConversation } from "../features/conversation/ConversationWorkspace";
import { ConversationRouteNavigationContext } from "../features/conversation/conversationRouteNavigation";
import { workspaceFeatures as features } from "../features/workspace/createWorkspaceFeatures";
import { WorkspaceConversationProviders } from "../features/workspace/WorkspaceConversationProviders";
import { newThreadService } from "../services/threads/newThreadService";
import {
  v1ThreadRouteParams,
  type V1ThreadRouteParams,
} from "../services/threads/threadRouteParams";
import { useWorkspaceRouteResources } from "../services/workspace/workspaceRouteResources";
import { useEvent } from "../react/useEvent";
import { useThreePanels } from "../ui/threePanels";
import { LinkedPullRequestChipProvider } from "./LinkedPullRequestChipProvider";
import { usePullRequestNavigation } from "./pullRequestNavigation";
import { useThreadRouteNavigation } from "./threadRouteNavigation";

/** The review chat is always declared closable; outside a pane nothing can close it. */
function ignoreClose(): void {}

/**
 * Mounts the canonical conversation surface for the PR-linked thread in the right pane: its header
 * (`ThreePanelsHeader`) shows the pane's close and fullscreen. The route's own pull request is the
 * neighbouring pane in every arrangement of this route (split, PR fullscreen, chat fullscreen), so
 * the composer's linked-PR chip excludes it.
 */
export function PullRequestConversationPane({
  connectionId,
  onManageProjects,
  threadId,
}: {
  readonly connectionId: string;
  /** Presents project management over the mounted PR route; it never navigates. */
  readonly onManageProjects: () => void;
  readonly threadId: ThreadId;
}): React.JSX.Element | null {
  const parsed = v1ThreadRouteParams({ connectionId, threadId });
  const navigation = usePullRequestNavigation();
  const openPullRequest = useEvent((linked: PullRequestKey): void => {
    navigation.openPullRequest(connectionId, linked);
  });
  return parsed.status === "invalid" ? null : (
    <LinkedPullRequestChipProvider
      connectionId={connectionId}
      onOpen={openPullRequest}
      threadId={threadId}
    >
      <ValidPullRequestConversation onManageProjects={onManageProjects} thread={parsed.value} />
    </LinkedPullRequestChipProvider>
  );
}

function ValidPullRequestConversation({
  onManageProjects,
  thread,
}: {
  readonly onManageProjects: () => void;
  readonly thread: V1ThreadRouteParams;
}): React.JSX.Element {
  const onClose = useThreePanels().chrome.close ?? ignoreClose;
  const router = useRouter();
  const resources = useWorkspaceRouteResources();
  const navigation = useThreadRouteNavigation(router, thread);
  const connectionId = thread.connectionId.value;
  const threadId = thread.threadId.value;
  const closeDraft = useEvent((draftId: string): void => {
    newThreadService.close(draftId);
  });
  return (
    <ConversationRouteNavigationContext.Provider value={navigation}>
      <WorkspaceConversationProviders
        activeConnectionId={connectionId}
        composerThreadId={threadId}
        feedback={resources.browserFeedback}
        initialBrowserDestination={`${connectionId}\u0000${threadId}`}
        runtime={resources.runtime}
      >
        <ActiveWorkspaceConversation
          connections={resources.connections}
          desktop={false}
          destination={{
            connectionId,
            kind: "thread",
            searchWindow: null,
            threadId,
          }}
          features={features}
          fileTransferController={workspaceRuntime.fileTransferController}
          loadedThreadSummaries={resources.list.loadedThreadSummaries}
          native={workspaceRuntime.native}
          onChangeDraftProject={() => undefined}
          onChangeDraftWorkspaceMode={() => undefined}
          onClose={onClose}
          onDraftAdmitted={closeDraft}
          onExitSearchHistory={onClose}
          onFixUnsupportedBlock={resources.recovery.createUnsupportedFixThread}
          onManageProjects={onManageProjects}
          onOpenBrowser={resources.openBrowser}
          onOpenBrowserInThread={resources.openBrowserInThread}
          onSelectThread={resources.list.selectThread}
          onShowActiveThreads={() => {
            resources.list.listState.setThreadListMode("active");
          }}
          pendingRequests={resources.pendingRequests}
          runtime={resources.runtime}
          scopedThreads={resources.list.scopedThreads}
          servers={resources.list.servers}
          voiceController={workspaceRuntime.voiceController}
        />
      </WorkspaceConversationProviders>
    </ConversationRouteNavigationContext.Provider>
  );
}
