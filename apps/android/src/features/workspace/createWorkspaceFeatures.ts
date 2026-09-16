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
function createWorkspaceFeatures() {
  const connections = createConnectionsWorkspaceAdapter({
    closeCatalogWindows: workspaceCatalog.closeCatalogWindows,
    currentConnections: currentConnections,
    forgetHttpAuthorization: forgetHttpAuthorization,
    forgetObservedThread: workspaceThreadSync.forgetObservedThread,
    getAccountRateLimits: () => workspaceRuntime.snapshot.accountRateLimits,
    getConnectionState: () => workspaceRuntime.snapshot.connectionState,
    getProfiles: () => workspaceRuntime.snapshot.connectionProfiles,
    getSession: (connectionId) => workspaceRuntime.supervisor?.session(connectionId),
    getThreadUiState: () => workspaceRuntime.snapshot.threadUiState,
    invalidateCatalog: workspaceCatalog.invalidateConnection,
  });
  const search = createSearchWorkspaceAdapter({
    getPendingRequests: () => workspaceRuntime.snapshot.pendingRequests,
    getSession: (connectionId) => workspaceRuntime.supervisor?.session(connectionId),
    getSummaries: () => workspaceRuntime.snapshot.threadSummaries,
    rpcAfterAttach: rpcAfterAttach,
  });
  const projects = createProjectsWorkspaceAdapter({
    getDetails: () => workspaceRuntime.snapshot.threadDetails,
    getSession: (connectionId) => workspaceRuntime.supervisor?.session(connectionId),
    getSummaries: () => workspaceRuntime.snapshot.threadSummaries,
    loadTurnControls: loadTurnControls,
    rpcAfterAttach: rpcAfterAttach,
  });
  const turnActions = createTurnActionsWorkspaceAdapter({
    getDetails: () => workspaceRuntime.snapshot.threadDetails,
    getSession: (connectionId) => workspaceRuntime.supervisor?.session(connectionId),
    getSummaries: () => workspaceRuntime.snapshot.threadSummaries,
    getThreadUiState: () => workspaceRuntime.snapshot.threadUiState,
    rpcAfterAttach: rpcAfterAttach,
  });
  const composer = createComposerWorkspaceAdapter({
    getThreadUiState: () => workspaceRuntime.snapshot.threadUiState,
    loadTurnControls: loadTurnControls,
    retryFailedMessage: commandDelivery.retryFailedMessage,
    sendText: commandDelivery.sendText,
    startVoiceTranscription: startVoiceTranscription,
  });
  const conversation = createConversationWorkspaceAdapter({
    getThreadUiState: () => workspaceRuntime.snapshot.threadUiState,
    loadTurnItems: workspaceThreadSync.loadTurnItems,
    observeThread: workspaceThreadSync.observeThread,
    readThread: workspaceThreadSync.readThread,
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
    refreshAccountRateLimits: refreshAccountRateLimits,
    rpcAfterAttach: rpcAfterAttach,
  });
  const ports = createPortsWorkspaceAdapter({
    currentConnections: currentConnections,
    getResources: () => workspaceRuntime.resourceDatabase,
    scopedHttpAuthorization: scopedHttpAuthorization,
  });
  const requests = createRequestsWorkspaceAdapter({
    getPendingRequests: () => workspaceRuntime.snapshot.pendingRequests,
  });
  const agents = { refreshSubagents: workspaceCatalog.refreshSubagents };
  const attachments = { transferAccess: transferAccess };
  const changes = {
    loadThreadChangeDiff: workspaceThreadResources.loadThreadChangeDiff,
    loadThreadResources: workspaceThreadResources.loadThreadResources,
  };
  return {
    accounts,
    agents,
    attachments,
    changes,
    composer,
    connections,
    conversation,
    goal,
    ports,
    projects,
    queue,
    requests,
    review,
    search,
    terminal,
    turnActions,
  };
}
export const workspaceFeatures = createWorkspaceFeatures();
