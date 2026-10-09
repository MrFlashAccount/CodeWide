import type {
  ReviewDelivery,
  ReviewTarget,
  ThreadGoal,
} from "@codewide/codex-protocol/v0.155.1/v2";
import type { SendMode, TurnSendOptions } from "../../data/thread-delivery-state";
import type { ThreadSettings, TurnControlsLoadOptions } from "../../data/turn-controls-types";
import type {
  VoiceTranscriptionEvent,
  VoiceTranscriptionOptions,
} from "../../data/voice-input-controller";
import type { ThreadChangeScope, ThreadGoalInput } from "../../data/workspace-resource-database";
import type { NewThreadDraft } from "../../services/threads/newThreadService";
import type { useGoalCommands } from "../goal/goalCommands";
import type { createNewChatSubmission } from "../projects/newChatSubmission";
import type { useQueueCommands } from "../queue/queueCommands";
import type { ConversationWorkspaceFeatures } from "./conversationWorkspaceFeatures";

type Scope =
  | { draft: NewThreadDraft; kind: "draft"; onSend: ReturnType<typeof createNewChatSubmission> }
  | { connectionId: string; kind: "thread"; threadId: string }
  | { kind: "empty" };
/** Enables only the feature capabilities belonging to the captured selection scope. */
export function createConversationScopeBindings(
  features: ConversationWorkspaceFeatures,
  scope: Scope,
  queueCommands: ReturnType<typeof useQueueCommands>,
  goalCommands: ReturnType<typeof useGoalCommands>,
) {
  if (scope.kind === "draft") {
    const newChatDraft = scope.draft;
    return {
      captureGoalLifecycle: undefined,
      getTransferAccess: async (forceRefresh = false) =>
        features.attachments.transferAccess(newChatDraft.connectionId, forceRefresh),
      onCancelQueued: undefined,
      onClearGoal: undefined,
      onCompact: undefined,
      onContinueTurn: undefined,
      onCreateTunnel: undefined,
      onEditQueued: undefined,
      onGetGoal: undefined,
      onInterrupt: undefined,
      onListQueue: undefined,
      onListTerminals: undefined,
      onLoadControls: async (cwd: string, options?: TurnControlsLoadOptions) =>
        features.composer.loadTurnControls(newChatDraft.connectionId, cwd, options),
      onLoadThreadChangeDiff: undefined,
      onLoadThreadResources: undefined,
      onMoveQueued: undefined,
      onRespondToRequest: undefined,
      onRetryFailedMessage: undefined,
      onRevokeTunnel: undefined,
      onSend: scope.onSend,
      onSetGoal: undefined,
      onSetGoalStatus: undefined,
      onStartReview: undefined,
      onStartVoiceTranscription: async (
        listener: (event: VoiceTranscriptionEvent) => void,
        options?: VoiceTranscriptionOptions,
      ) =>
        features.composer.startVoiceTranscription(
          newChatDraft.connectionId,
          newChatDraft.id,
          listener,
          options,
        ),
      onSteerQueued: undefined,
      onTerminateTerminal: undefined,
      onUpdateSettings: undefined,
    };
  }
  if (scope.kind === "empty") {
    return {
      captureGoalLifecycle: undefined,
      getTransferAccess: undefined,
      onCancelQueued: undefined,
      onClearGoal: undefined,
      onCompact: undefined,
      onContinueTurn: undefined,
      onCreateTunnel: undefined,
      onEditQueued: undefined,
      onGetGoal: undefined,
      onInterrupt: undefined,
      onListQueue: undefined,
      onListTerminals: undefined,
      onLoadControls: undefined,
      onLoadThreadChangeDiff: undefined,
      onLoadThreadResources: undefined,
      onMoveQueued: undefined,
      onRespondToRequest: undefined,
      onRetryFailedMessage: undefined,
      onRevokeTunnel: undefined,
      onSend: undefined,
      onSetGoal: undefined,
      onSetGoalStatus: undefined,
      onStartReview: undefined,
      onStartVoiceTranscription: undefined,
      onSteerQueued: undefined,
      onTerminateTerminal: undefined,
      onUpdateSettings: undefined,
    };
  }
  const { connectionId: activeConnectionId, threadId: activeRemoteThreadId } = scope;
  return {
    captureGoalLifecycle: goalCommands.captureGoalLifecycle,
    getTransferAccess: async (forceRefresh = false) =>
      features.attachments.transferAccess(activeConnectionId, forceRefresh),
    onCancelQueued: queueCommands.onCancelQueued,
    onClearGoal: goalCommands.onClearGoal,
    onCompact: async () => {
      await features.turnActions.compactThread(activeConnectionId, activeRemoteThreadId);
    },
    onContinueTurn: async (sourceTurnId: string): Promise<void> => {
      await features.composer.continueTurn(activeConnectionId, activeRemoteThreadId, sourceTurnId);
    },
    onCreateTunnel: async (port: number, ttlSeconds: number) =>
      features.ports.createLocalhostTunnel(activeConnectionId, port, ttlSeconds),
    onEditQueued: queueCommands.onEditQueued,
    onGetGoal: goalCommands.onGetGoal,
    onInterrupt: async (turnId: string) => {
      await features.turnActions.interruptTurn(activeConnectionId, activeRemoteThreadId, turnId);
    },
    onListQueue: queueCommands.onListQueue,
    onListTerminals: async () =>
      features.terminal.listBackgroundTerminals(activeConnectionId, activeRemoteThreadId),
    onLoadControls: async (cwd: string, options?: TurnControlsLoadOptions) =>
      features.composer.loadTurnControls(activeConnectionId, cwd, options),
    onLoadThreadChangeDiff: async (path: string, scope?: ThreadChangeScope) =>
      features.changes.loadThreadChangeDiff(activeConnectionId, activeRemoteThreadId, path, scope),
    onLoadThreadResources: async (
      scope?: ThreadChangeScope,
      kind?: "all" | "changes" | "attachments",
    ) =>
      features.changes.loadThreadResources(activeConnectionId, activeRemoteThreadId, scope, kind),
    onMoveQueued: queueCommands.onMoveQueued,
    onRespondToRequest: features.requests.respondToServerRequest,
    onRetryFailedMessage: async (commandId: string) => {
      await features.composer.retryFailedMessage(activeConnectionId, commandId);
    },
    onRevokeTunnel: async (tunnelId: string) => {
      await features.ports.revokeLocalhostTunnel(activeConnectionId, tunnelId);
    },
    onSend: async (text: string, mode: SendMode, options: TurnSendOptions) =>
      features.composer.sendText(activeConnectionId, activeRemoteThreadId, text, mode, options),
    // Goal submission (including delayed voice Send) belongs to this selection,
    // not to the latest selection observed by a retained UI callback.
    onSetGoal: async (input: ThreadGoalInput): Promise<ThreadGoal> =>
      features.goal.setThreadGoal(activeConnectionId, activeRemoteThreadId, input),
    onSetGoalStatus: goalCommands.onSetGoalStatus,
    onStartReview: async (target: ReviewTarget, delivery: ReviewDelivery) =>
      features.review.startReview(activeConnectionId, activeRemoteThreadId, target, delivery),
    onStartVoiceTranscription: async (
      listener: (event: VoiceTranscriptionEvent) => void,
      options?: VoiceTranscriptionOptions,
    ) =>
      features.composer.startVoiceTranscription(
        activeConnectionId,
        activeRemoteThreadId,
        listener,
        options,
      ),
    onSteerQueued: queueCommands.onSteerQueued,
    onTerminateTerminal: async (processId: string) =>
      features.terminal.terminateBackgroundTerminal(
        activeConnectionId,
        activeRemoteThreadId,
        processId,
      ),
    onUpdateSettings: async (settings: ThreadSettings) => {
      await features.composer.updateThreadSettings(
        activeConnectionId,
        activeRemoteThreadId,
        settings,
      );
    },
  };
}
