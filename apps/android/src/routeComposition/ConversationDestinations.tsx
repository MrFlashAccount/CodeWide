import type { ThreadDetailDatabase } from "../data/thread-detail-database";
import { threadResourceKey } from "../data/workspace-resource-keys";
import { SubagentSheet } from "../features/agents/SubagentSheet";
import { ThreadAttachmentsRoute } from "../features/attachments/ThreadAttachmentsRoute";
import { CommandContentViewer } from "../features/conversation/content/CommandContentViewer";
import { ContentDocumentViewer } from "../features/conversation/content/ContentDocumentViewer";
import { SubagentConversation } from "../features/conversation/SubagentConversation";
import { ComposerControlRoute } from "../features/composer/ComposerControlRoute";
import {
  ComposerGoalRoute,
  ComposerQueueRoute,
  ComposerReviewRoute,
} from "../features/composer/ComposerActionRoutes";
import {
  ComposerPortsRoute,
  ComposerRuntimeRoute,
} from "../features/composer/ComposerRuntimeRoutes";
import { workspaceFeatures as features } from "../features/workspace/createWorkspaceFeatures";
import type { DocumentPreviewRequest } from "../rendering/DocumentPreviewHost";
import type { AgentRouteRequest } from "../services/agents/agentRouteSession";
import type { ComposerToolRouteRequest } from "../services/composer/composerToolRouteSession";
import type { LargeContentRouteRequest } from "../services/content/contentRouteSession";
import type { WorkspaceRouteResources } from "../services/workspace/workspaceRouteResources";

/**
 * Renders one conversation destination's content for its captured request. The thread child routes
 * and the review chat's pane-local presenter render the same content, so a destination looks and
 * behaves the same whichever owner presents it; only the presentation lifetime differs.
 */
export function ContentDestination({
  connectionId,
  database,
  onClose,
  request,
}: {
  readonly connectionId: string;
  readonly database: ThreadDetailDatabase | null;
  readonly onClose: () => void;
  readonly request: LargeContentRouteRequest;
}): React.JSX.Element {
  if (request.kind === "document") {
    return <ContentDocumentViewer onClose={onClose} request={request} />;
  }
  return (
    <CommandContentViewer
      connectionId={connectionId}
      database={database}
      onClose={onClose}
      request={request}
      threadId={request.threadId}
    />
  );
}

/** The subagent workspace of one parent conversation, captured when it was opened. */
export function SubagentsDestination({
  connectionId,
  initialThreadId,
  loadTurnChanges,
  onClose,
  request,
  resources,
  threadDetails,
}: {
  readonly connectionId: string;
  readonly initialThreadId: string | null;
  readonly loadTurnChanges: Parameters<typeof SubagentConversation>[0]["loadTurnChanges"];
  readonly onClose: () => void;
  readonly request: AgentRouteRequest;
  readonly resources: WorkspaceRouteResources;
  readonly threadDetails: ThreadDetailDatabase;
}): React.JSX.Element {
  return (
    <SubagentSheet
      connectionId={connectionId}
      initialThreadId={initialThreadId ?? request.initialThreadId}
      onClose={onClose}
      parentLabel={request.parentLabel}
      parentThreadId={request.parentThreadId}
      renderThread={(view) => (
        <SubagentConversation
          details={threadDetails}
          fixUnsupportedBlock={resources.recovery.createUnsupportedFixThread}
          getTransferAccess={async (forceRefresh) =>
            features.attachments.transferAccess(connectionId, forceRefresh)
          }
          loadControls={async (cwd, options) =>
            features.composer.loadTurnControls(connectionId, cwd, options)
          }
          loadTurnChanges={loadTurnChanges}
          refresh={async (rootThreadId) =>
            features.agents.refreshSubagents(connectionId, rootThreadId)
          }
          server={resources.list.servers.find((server) => server.id === connectionId)}
          summaries={resources.runtime.threadSummaries}
          view={view}
          workspaceResources={resources.runtime.resources}
        />
      )}
      summaries={request.summaries}
      threadDetails={threadDetails}
    />
  );
}

/** One thread's attachments sheet; documents open through the presenting owner. */
export function AttachmentsDestination({
  connectionId,
  onClose,
  onOpenCodeDocument,
  onOpenDocument,
  resources,
  threadId,
  visible,
}: {
  readonly connectionId: string;
  readonly onClose: () => void;
  readonly onOpenCodeDocument: (request: DocumentPreviewRequest) => void;
  readonly onOpenDocument: (request: DocumentPreviewRequest) => void;
  readonly resources: WorkspaceRouteResources;
  readonly threadId: string;
  readonly visible: boolean;
}): React.JSX.Element {
  const cwd =
    resources.list.loadedThreadSummaries.find(
      (thread) => thread.connectionId === connectionId && thread.remoteThreadId === threadId,
    )?.cwd ?? "/workspace";
  return (
    <ThreadAttachmentsRoute
      cwd={cwd}
      getTransferAccess={async (forceRefresh = false) =>
        features.attachments.transferAccess(connectionId, forceRefresh)
      }
      model={resources.runtime.resources?.threadResources ?? null}
      onClose={onClose}
      onOpenBrowser={resources.openBrowser}
      onOpenCodeDocument={onOpenCodeDocument}
      onOpenDocument={onOpenDocument}
      onReload={async () =>
        features.changes.loadThreadResources(connectionId, threadId, undefined, "attachments")
      }
      resourceId={threadResourceKey(connectionId, threadId)}
      revision={
        resources.connections.find((connection) => connection.id === connectionId)?.state ??
        "offline"
      }
      visible={visible}
    />
  );
}

/** One composer tool sheet (controls, queue, goal, review, ports or runtime) for its request. */
export function ComposerToolDestination({
  onClose,
  request,
  visible,
}: {
  readonly onClose: () => void;
  readonly request: ComposerToolRouteRequest;
  readonly visible: boolean;
}): React.JSX.Element {
  switch (request.kind) {
    case "model":
    case "permissions":
    case "skills":
      return <ComposerControlRoute onClose={onClose} request={request} visible={visible} />;
    case "queue":
      return <ComposerQueueRoute onClose={onClose} request={request} visible={visible} />;
    case "goal":
      return <ComposerGoalRoute onClose={onClose} request={request} visible={visible} />;
    case "review":
      return <ComposerReviewRoute onClose={onClose} request={request} visible={visible} />;
    case "ports":
      return <ComposerPortsRoute onClose={onClose} request={request} visible={visible} />;
    case "runtime":
      break;
  }
  return <ComposerRuntimeRoute onClose={onClose} request={request} visible={visible} />;
}
