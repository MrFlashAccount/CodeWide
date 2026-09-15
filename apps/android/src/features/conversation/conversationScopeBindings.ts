import type { ReviewDelivery, ReviewTarget } from "@codewide/codex-protocol/v0.147.0/v2";
import { type SendMode, type TurnSendOptions } from "../../data/thread-delivery-state";
import { type ThreadSettings } from "../../data/turn-controls-types";
import {
  type VoiceTranscriptionEvent,
  type VoiceTranscriptionOptions,
} from "../../data/voice-input-controller";
import type { ThreadChangeScope } from "../../data/workspace-resource-database";
import { useGoalCommands } from "../goal/goalCommands";
import type { NewChatDraft } from "../navigation/threadNavigation";
import type { createNewChatSubmission } from "../projects/newChatSubmission";
import { useQueueCommands } from "../queue/queueCommands";
import type { ConversationWorkspaceFeatures } from "./conversationWorkspaceFeatures";
type Scope =
  | { kind: "draft"; draft: NewChatDraft; onSend: ReturnType<typeof createNewChatSubmission> }
  | { kind: "thread"; connectionId: string; threadId: string }
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
      onSend: scope.onSend,
      onLoadControls: async (cwd: string) =>
        await features.composer.loadTurnControls(newChatDraft.serverId, cwd),
      getTransferAccess: async (forceRefresh = false) =>
        await features.attachments.transferAccess(newChatDraft.serverId, forceRefresh),
      onStartVoiceTranscription: async (
        listener: (event: VoiceTranscriptionEvent) => void,
        options?: VoiceTranscriptionOptions,
      ) =>
        await features.composer.startVoiceTranscription(
          newChatDraft.serverId,
          newChatDraft.id,
          listener,
          options,
        ),
      onRetryFailedMessage: undefined,
      onUpdateSettings: undefined,
      onInterrupt: undefined,
      onListQueue: undefined,
      onEditQueued: undefined,
      onCancelQueued: undefined,
      onMoveQueued: undefined,
      onSteerQueued: undefined,
      onListTerminals: undefined,
      onLoadThreadResources: undefined,
      onLoadThreadChangeDiff: undefined,
      onTerminateTerminal: undefined,
      onGetGoal: undefined,
      onSetGoal: undefined,
      onClearGoal: undefined,
      onStartReview: undefined,
      onCompact: undefined,
      onCreateTunnel: undefined,
      onRevokeTunnel: undefined,
      onRespondToRequest: undefined,
    };
  }
  if (scope.kind === "empty")
    return {
      onSend: undefined,
      onLoadControls: undefined,
      getTransferAccess: undefined,
      onStartVoiceTranscription: undefined,
      onRetryFailedMessage: undefined,
      onUpdateSettings: undefined,
      onInterrupt: undefined,
      onListQueue: undefined,
      onEditQueued: undefined,
      onCancelQueued: undefined,
      onMoveQueued: undefined,
      onSteerQueued: undefined,
      onListTerminals: undefined,
      onLoadThreadResources: undefined,
      onLoadThreadChangeDiff: undefined,
      onTerminateTerminal: undefined,
      onGetGoal: undefined,
      onSetGoal: undefined,
      onClearGoal: undefined,
      onStartReview: undefined,
      onCompact: undefined,
      onCreateTunnel: undefined,
      onRevokeTunnel: undefined,
      onRespondToRequest: undefined,
    };
  const { connectionId: activeConnectionId, threadId: activeRemoteThreadId } = scope;
  return {
    onSend: async (text: string, mode: SendMode, options: TurnSendOptions) =>
      await features.composer.sendText(
        activeConnectionId,
        activeRemoteThreadId,
        text,
        mode,
        options,
      ),
    onLoadControls: async (cwd: string) =>
      await features.composer.loadTurnControls(activeConnectionId, cwd),
    getTransferAccess: async (forceRefresh = false) =>
      await features.attachments.transferAccess(activeConnectionId, forceRefresh),
    onStartVoiceTranscription: async (
      listener: (event: VoiceTranscriptionEvent) => void,
      options?: VoiceTranscriptionOptions,
    ) =>
      await features.composer.startVoiceTranscription(
        activeConnectionId,
        activeRemoteThreadId,
        listener,
        options,
      ),
    onRetryFailedMessage: async (commandId: string) =>
      await features.composer.retryFailedMessage(activeConnectionId, commandId),
    onUpdateSettings: async (settings: ThreadSettings) => {
      await features.composer.updateThreadSettings(
        activeConnectionId,
        activeRemoteThreadId,
        settings,
      );
    },
    onInterrupt: async (turnId: string) => {
      await features.turnActions.interruptTurn(activeConnectionId, activeRemoteThreadId, turnId);
    },
    onListQueue: queueCommands.onListQueue,
    onEditQueued: queueCommands.onEditQueued,
    onCancelQueued: queueCommands.onCancelQueued,
    onMoveQueued: queueCommands.onMoveQueued,
    onSteerQueued: queueCommands.onSteerQueued,
    onListTerminals: async () =>
      await features.terminal.listBackgroundTerminals(activeConnectionId, activeRemoteThreadId),
    onLoadThreadResources: async (
      scope?: ThreadChangeScope,
      kind?: "all" | "changes" | "attachments",
    ) =>
      await features.changes.loadThreadResources(
        activeConnectionId,
        activeRemoteThreadId,
        scope,
        kind,
      ),
    onLoadThreadChangeDiff: async (path: string, scope?: ThreadChangeScope) =>
      await features.changes.loadThreadChangeDiff(
        activeConnectionId,
        activeRemoteThreadId,
        path,
        scope,
      ),
    onTerminateTerminal: async (processId: string) =>
      await features.terminal.terminateBackgroundTerminal(
        activeConnectionId,
        activeRemoteThreadId,
        processId,
      ),
    onGetGoal: goalCommands.onGetGoal,
    onSetGoal: goalCommands.onSetGoal,
    onClearGoal: goalCommands.onClearGoal,
    onStartReview: async (target: ReviewTarget, delivery: ReviewDelivery) =>
      await features.review.startReview(activeConnectionId, activeRemoteThreadId, target, delivery),
    onCompact: async () =>
      await features.turnActions.compactThread(activeConnectionId, activeRemoteThreadId),
    onCreateTunnel: async (port: number, ttlSeconds: number) =>
      await features.ports.createLocalhostTunnel(activeConnectionId, port, ttlSeconds),
    onRevokeTunnel: async (tunnelId: string) => {
      await features.ports.revokeLocalhostTunnel(activeConnectionId, tunnelId);
    },
    onRespondToRequest: features.requests.respondToServerRequest,
  };
}
