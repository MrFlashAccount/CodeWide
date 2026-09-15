import {
  commandDelivery,
  currentConnections,
  forgetHttpAuthorization,
  loadTurnControls,
  refreshAccountRateLimits,
  rpcAfterAttach,
  scopedHttpAuthorization,
  startVoiceTranscription,
  transferAccess,
  workspaceCatalog,
  workspaceRuntime,
  workspaceThreadResources,
  workspaceThreadSync,
} from "../../data/workspace-runtime";
import { createAccountsWorkspaceAdapter } from "../accounts/workspaceAdapter";
import { createComposerWorkspaceAdapter } from "../composer/workspaceAdapter";
import { createConnectionsWorkspaceAdapter } from "../connections/workspaceAdapter";
import { createConversationWorkspaceAdapter } from "../conversation/workspaceAdapter";
import { createGoalWorkspaceAdapter } from "../goal/workspaceAdapter";
import { createPortsWorkspaceAdapter } from "../ports/workspaceAdapter";
import { createProjectsWorkspaceAdapter } from "../projects/workspaceAdapter";
import { createQueueWorkspaceAdapter } from "../queue/workspaceAdapter";
import { createRequestsWorkspaceAdapter } from "../requests/workspaceAdapter";
import { createReviewWorkspaceAdapter } from "../review/workspaceAdapter";
import { createSearchWorkspaceAdapter } from "../search/workspaceAdapter";
import { createTerminalWorkspaceAdapter } from "../terminal/workspaceAdapter";
import { createTurnActionsWorkspaceAdapter } from "../turnActions/workspaceAdapter";

/** Constructs stable feature capabilities over the existing module-lifetime runtime. */
export function createWorkspaceFeatures() {
  const connections = createConnectionsWorkspaceAdapter({
    getProfiles: () => workspaceRuntime.snapshot.connectionProfiles,
    getConnectionState: () => workspaceRuntime.snapshot.connectionState,
    getThreadUiState: () => workspaceRuntime.snapshot.threadUiState,
    getAccountRateLimits: () => workspaceRuntime.snapshot.accountRateLimits,
    getSession: (connectionId) => workspaceRuntime.supervisor?.session(connectionId),
    forgetObservedThread: workspaceThreadSync.forgetObservedThread,
    invalidateCatalog: workspaceCatalog.invalidateConnection,
    closeCatalogWindows: workspaceCatalog.closeCatalogWindows,
    currentConnections: currentConnections,
    forgetHttpAuthorization: forgetHttpAuthorization,
  });
  const search = createSearchWorkspaceAdapter({
    getSummaries: () => workspaceRuntime.snapshot.threadSummaries,
    getPendingRequests: () => workspaceRuntime.snapshot.pendingRequests,
    getSession: (connectionId) => workspaceRuntime.supervisor?.session(connectionId),
    rpcAfterAttach: rpcAfterAttach,
  });
  const projects = createProjectsWorkspaceAdapter({
    getSummaries: () => workspaceRuntime.snapshot.threadSummaries,
    getDetails: () => workspaceRuntime.snapshot.threadDetails,
    getSession: (connectionId) => workspaceRuntime.supervisor?.session(connectionId),
    rpcAfterAttach: rpcAfterAttach,
    loadTurnControls: loadTurnControls,
  });
  const turnActions = createTurnActionsWorkspaceAdapter({
    getSummaries: () => workspaceRuntime.snapshot.threadSummaries,
    getDetails: () => workspaceRuntime.snapshot.threadDetails,
    getSession: (connectionId) => workspaceRuntime.supervisor?.session(connectionId),
    rpcAfterAttach: rpcAfterAttach,
  });
  const composer = createComposerWorkspaceAdapter({
    getThreadUiState: () => workspaceRuntime.snapshot.threadUiState,
    loadTurnControls: loadTurnControls,
    sendText: commandDelivery.sendText,
    retryFailedMessage: commandDelivery.retryFailedMessage,
    startVoiceTranscription: startVoiceTranscription,
  });
  const conversation = createConversationWorkspaceAdapter({
    getThreadUiState: () => workspaceRuntime.snapshot.threadUiState,
    readThread: workspaceThreadSync.readThread,
    observeThread: workspaceThreadSync.observeThread,
    loadTurnItems: workspaceThreadSync.loadTurnItems,
  });
  const queue = createQueueWorkspaceAdapter({
    getDetails: () => workspaceRuntime.snapshot.threadDetails,
    getSession: (connectionId) => workspaceRuntime.supervisor?.session(connectionId),
    rpcAfterAttach: rpcAfterAttach,
  });
  const terminal = createTerminalWorkspaceAdapter({
    getResources: () => workspaceRuntime.resourceDatabase,
    getSession: (connectionId) => workspaceRuntime.supervisor?.session(connectionId),
    rpcAfterAttach: rpcAfterAttach,
  });
  const goal = createGoalWorkspaceAdapter({
    getResources: () => workspaceRuntime.resourceDatabase,
    getSession: (connectionId) => workspaceRuntime.supervisor?.session(connectionId),
    rpcAfterAttach: rpcAfterAttach,
  });
  const review = createReviewWorkspaceAdapter({
    getSession: (connectionId) => workspaceRuntime.supervisor?.session(connectionId),
    rpcAfterAttach: rpcAfterAttach,
  });
  const accounts = createAccountsWorkspaceAdapter({
    getAccountRateLimits: () => workspaceRuntime.snapshot.accountRateLimits,
    getSession: (connectionId) => workspaceRuntime.supervisor?.session(connectionId),
    rpcAfterAttach: rpcAfterAttach,
    refreshAccountRateLimits: refreshAccountRateLimits,
  });
  const ports = createPortsWorkspaceAdapter({
    getResources: () => workspaceRuntime.resourceDatabase,
    currentConnections: currentConnections,
    scopedHttpAuthorization: scopedHttpAuthorization,
  });
  const requests = createRequestsWorkspaceAdapter({
    getPendingRequests: () => workspaceRuntime.snapshot.pendingRequests,
  });
  const agents = { refreshSubagents: workspaceCatalog.refreshSubagents };
  const attachments = { transferAccess: transferAccess };
  const changes = {
    loadThreadResources: workspaceThreadResources.loadThreadResources,
    loadThreadChangeDiff: workspaceThreadResources.loadThreadChangeDiff,
  };
  return {
    connections,
    search,
    projects,
    turnActions,
    composer,
    conversation,
    queue,
    terminal,
    goal,
    review,
    accounts,
    ports,
    requests,
    agents,
    attachments,
    changes,
  };
}
export const workspaceFeatures = createWorkspaceFeatures();
