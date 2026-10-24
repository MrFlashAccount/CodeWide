import { useRouter } from "expo-router";
import type { ReactNode } from "react";

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
import { useThreadRouteNavigation } from "./threadRouteNavigation";

/** Mounts the canonical conversation surface for the PR-linked thread. */
export function PullRequestConversationPane({
  connectionId,
  headerActions,
  onClose,
  threadId,
}: {
  readonly connectionId: string;
  readonly headerActions?: ReactNode;
  readonly onClose: () => void;
  readonly threadId: ThreadId;
}): React.JSX.Element | null {
  const parsed = v1ThreadRouteParams({ connectionId, threadId });
  return parsed.status === "invalid" ? null : (
    <ValidPullRequestConversation
      headerActions={headerActions}
      onClose={onClose}
      thread={parsed.value}
    />
  );
}

function ValidPullRequestConversation({
  headerActions,
  onClose,
  thread,
}: {
  readonly headerActions?: ReactNode;
  readonly onClose: () => void;
  readonly thread: V1ThreadRouteParams;
}): React.JSX.Element {
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
          destination={{ connectionId, kind: "thread", searchWindow: null, threadId }}
          features={features}
          fileTransferController={workspaceRuntime.fileTransferController}
          headerActions={headerActions}
          loadedThreadSummaries={resources.list.loadedThreadSummaries}
          native={workspaceRuntime.native}
          onChangeDraftProject={() => undefined}
          onChangeDraftWorkspaceMode={() => undefined}
          onClose={onClose}
          onDraftAdmitted={closeDraft}
          onExitSearchHistory={onClose}
          onFixUnsupportedBlock={resources.recovery.createUnsupportedFixThread}
          onManageProjects={() => {
            router.push("/projects");
          }}
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
