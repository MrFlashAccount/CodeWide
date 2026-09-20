import { useEvent } from "../../react/useEvent";
import type { useComposerCommands } from "../composer/composerCommands";
import type { ComposerMenuPage } from "../composer/composerTypes";
import type { ConversationCompositionCapabilities } from "./conversationCompositionCapabilities";
import type { useConversationScopeFeatures } from "./conversationScopeFeatures";
import type { useConversationRouteNavigation } from "./conversationRouteNavigation";
import type { useConversationTimelineRead } from "./timeline/conversationTimelineRead";

type ConversationToolRouteInput = {
  readonly props: ConversationCompositionCapabilities;
  readonly routeNavigation: ReturnType<typeof useConversationRouteNavigation>;
  readonly scoped: ReturnType<typeof useConversationScopeFeatures>;
  readonly timelineRead: ReturnType<typeof useConversationTimelineRead>;
  readonly visibleQueuedPrompts: ConversationCompositionCapabilities["queue"]["queuedPrompts"];
};

type QueueEditActions = Parameters<Parameters<typeof useComposerCommands>[0]["openToolRoute"]>[1];

function openControlRoute(
  input: ConversationToolRouteInput,
  kind: Extract<ComposerMenuPage, "model" | "permissions" | "skills">,
): void {
  const { props, routeNavigation, scoped } = input;
  const editing = scoped.composerStateBinding.composerEditingBinding;
  routeNavigation.openTool({
    controlError: editing.controlError,
    controlsResourceId: props.composer.controlsResourceId,
    invokeSkill: editing.insertSkillInvocation,
    kind,
    newChat: props.surface.newChat,
    resources: props.composer.workspaceResources,
    selectedEffort: editing.selectedEffort,
    selectedModel: editing.selectedModel,
    selectedPermissions: editing.selectedPermissions,
    selectedPersonality: editing.selectedPersonality,
    selectEffort: editing.selectEffort,
    selectModel: editing.selectModel,
    selectPermissions: editing.selectPermissions,
    selectPersonality: editing.setSelectedPersonality,
    thread: props.read.remoteThread ?? null,
    voiceScope: scoped.activation.composerScope,
    ...(props.attachments.getTransferAccess === undefined
      ? {}
      : { getTransferAccess: props.attachments.getTransferAccess }),
  });
}

function openQueueRoute(input: ConversationToolRouteInput, queueEdit: QueueEditActions): void {
  const { props, routeNavigation, scoped, timelineRead, visibleQueuedPrompts } = input;
  routeNavigation.openTool({
    activeTurnId: timelineRead.conversationPresentationBinding.currentTurnId,
    items: visibleQueuedPrompts,
    kind: "queue",
    ...(props.queue.onEditQueued === undefined ||
    scoped.composerStateBinding.composerVoiceStateBinding.voicePhase !== "idle"
      ? {}
      : { edit: queueEdit.beginQueuedComposerEdit }),
    ...(props.queue.onCancelQueued === undefined ? {} : { cancel: props.queue.onCancelQueued }),
    ...(props.queue.onMoveQueued === undefined ? {} : { move: props.queue.onMoveQueued }),
    ...(props.queue.onSteerQueued === undefined ? {} : { steer: props.queue.onSteerQueued }),
  });
}

function openGoalRoute(input: ConversationToolRouteInput): void {
  const { props, routeNavigation, scoped } = input;
  routeNavigation.openTool({
    goalResourceId: props.goal.goalResourceId,
    kind: "goal",
    resources: props.composer.workspaceResources,
    voiceScope: scoped.activation.composerScope,
    ...(props.goal.onSetGoal === undefined ? {} : { setGoal: props.goal.onSetGoal }),
    ...(props.goal.onClearGoal === undefined ? {} : { clearGoal: props.goal.onClearGoal }),
  });
}

function openReviewRoute(input: ConversationToolRouteInput): void {
  const { props, routeNavigation } = input;
  routeNavigation.openTool({
    kind: "review",
    ...(props.review.onStartReview === undefined
      ? {}
      : { startReview: props.review.onStartReview }),
  });
}

function openPortsRoute(input: ConversationToolRouteInput): void {
  const { props, routeNavigation } = input;
  routeNavigation.openTool({
    connectionId: props.ports.portForwardingConnectionId,
    kind: "ports",
    resources: props.composer.workspaceResources,
    serverName: props.ports.portForwardingServerName,
    tunnelResourceId: props.ports.tunnelResourceId,
    ...(props.ports.onOpenBrowser === undefined ? {} : { openBrowser: props.ports.onOpenBrowser }),
  });
}

function openRuntimeRoute(input: ConversationToolRouteInput): void {
  const { props, routeNavigation } = input;
  routeNavigation.openTool({
    backgroundTerminalsResourceId: props.terminal.backgroundTerminalsResourceId,
    connectionId: props.ports.portForwardingConnectionId,
    kind: "runtime",
    resources: props.composer.workspaceResources,
    serverName: props.ports.portForwardingServerName,
    tunnelResourceId: props.ports.tunnelResourceId,
    ...(props.ports.onOpenBrowser === undefined ? {} : { openBrowser: props.ports.onOpenBrowser }),
    ...(props.terminal.onListTerminals === undefined
      ? {}
      : { listTerminals: props.terminal.onListTerminals }),
    ...(props.terminal.onTerminateTerminal === undefined
      ? {}
      : { terminateTerminal: props.terminal.onTerminateTerminal }),
    ...(props.ports.onCreateTunnel === undefined
      ? {}
      : { createTunnel: props.ports.onCreateTunnel }),
    ...(props.ports.onRevokeTunnel === undefined
      ? {}
      : { revokeTunnel: props.ports.onRevokeTunnel }),
  });
}

/** Owns the composer-page to route-request mapping at the conversation boundary. */
export function useConversationToolRoute(
  input: ConversationToolRouteInput,
): (page: ComposerMenuPage, queueEdit: QueueEditActions) => void {
  return useEvent((page: ComposerMenuPage, queueEdit: QueueEditActions) => {
    const routes: Record<ComposerMenuPage, () => void> = {
      goal: () => {
        openGoalRoute(input);
      },
      model: () => {
        openControlRoute(input, "model");
      },
      permissions: () => {
        openControlRoute(input, "permissions");
      },
      ports: () => {
        openPortsRoute(input);
      },
      queue: () => {
        openQueueRoute(input, queueEdit);
      },
      review: () => {
        openReviewRoute(input);
      },
      runtime: () => {
        openRuntimeRoute(input);
      },
      skills: () => {
        openControlRoute(input, "skills");
      },
    };
    routes[page]();
  });
}
