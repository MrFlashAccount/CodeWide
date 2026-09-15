import type { ThreadConversationCapabilities } from "../turnActions/threadConversationCapabilities";
import type { QueueWorkspaceCapabilities } from "../queue/queueWorkspaceCapabilities";
import type { ProjectConversationCapabilities } from "../projects/projectConversationCapabilities";
import type { MainThreadReadCapabilities } from "./mainThreadReadCapabilities";
import type { ConversationTerminalCapabilities } from "../terminal/conversationTerminalCapabilities";
import type { ConversationSurfaceCapabilities } from "./conversationSurfaceCapabilities";
import type { ConversationReviewCapabilities } from "../review/conversationReviewCapabilities";
import type { ConversationPortCapabilities } from "../ports/conversationPortCapabilities";
import type { ConversationGoalCapabilities } from "../goal/conversationGoalCapabilities";
import type { ConversationChangeCapabilities } from "../changes/conversationChangeCapabilities";
import type { ConversationAttachmentCapabilities } from "../attachments/conversationAttachmentCapabilities";
import type { ComposerWorkspaceCapabilities } from "../composer/composerWorkspaceCapabilities";
import type { QueuedPrompt } from "../../data/thread-delivery-state";
import { ContentReviewComposer } from "../../rendering/ContentReviewHost";
import { type AppVoiceInputRuntime } from "../../ui/VoiceInputRuntime";
import { ThreadResourcesSheet } from "../attachments/AttachmentsFeature";
import { useDocumentTransferAccess } from "../attachments/documentNavigation";
import { useComposerProjectSelection } from "../projects/composerProjectSelection";
import { ProjectPickerSheet } from "../projects/ProjectPickerSheet";
import { type ThreadListItem } from "../threadList/threadListTypes";
import { useThreadRename } from "../turnActions/threadRename";
import { ThreadRenameDialog } from "../turnActions/ThreadRenameDialog";
import { ComposerMenuComposition } from "../workspace/ComposerMenuComposition";
import { useComposerCommands } from "../composer/composerCommands";
import { useComposerState } from "../composer/composerState";
import { useConversationTools } from "./ConversationTools";
import { TOOL_RESULT_MAX_HEIGHT } from "./protocol/ToolContent";
import { useConversationTimelineRead } from "./timeline/conversationTimelineRead";
export function createConversationOverlayContent({
  surfaceInputs,
  composerStateBinding,
  readInputs,
  composerCommands,
  composerInputs,
  terminalInputs,
  goalInputs,
  portsInputs,
  visibleQueuedPrompts,
  timelineRead,
  composerScope,
  queueInputs,
  attachmentsInputs,
  getStableTransferAccess,
  reviewInputs,
  composerProjectSelectionBinding,
  projectsInputs,
  threadRenameBinding,
  thread,
  actionsInputs,
  toolsBinding,
  changesInputs,
  appVoiceInputRuntime,
}: {
  surfaceInputs: ConversationSurfaceCapabilities;
  composerStateBinding: ReturnType<typeof useComposerState>;
  readInputs: MainThreadReadCapabilities;
  composerCommands: ReturnType<typeof useComposerCommands>;
  composerInputs: ComposerWorkspaceCapabilities;
  terminalInputs: ConversationTerminalCapabilities;
  goalInputs: ConversationGoalCapabilities;
  portsInputs: ConversationPortCapabilities;
  visibleQueuedPrompts: QueuedPrompt[];
  timelineRead: ReturnType<typeof useConversationTimelineRead>;
  composerScope: string;
  queueInputs: QueueWorkspaceCapabilities;
  attachmentsInputs: ConversationAttachmentCapabilities;
  getStableTransferAccess: ReturnType<typeof useDocumentTransferAccess>;
  reviewInputs: ConversationReviewCapabilities;
  composerProjectSelectionBinding: ReturnType<typeof useComposerProjectSelection>;
  projectsInputs: ProjectConversationCapabilities;
  threadRenameBinding: ReturnType<typeof useThreadRename>;
  thread: ThreadListItem;
  actionsInputs: ThreadConversationCapabilities;
  toolsBinding: ReturnType<typeof useConversationTools>;
  changesInputs: ConversationChangeCapabilities;
  appVoiceInputRuntime: AppVoiceInputRuntime;
}) {
  const { onManageProjects } = projectsInputs;
  const { onLoadThreadResources } = changesInputs;
  const reviewContent = <ContentReviewComposer targetPrefix="agent-response:" />;
  const menuContent = (
    <ComposerMenuComposition
      newChat={surfaceInputs.newChat}
      visible={composerStateBinding.composerMenuStateBinding.menuVisible}
      thread={readInputs.remoteThread ?? null}
      initialPage={composerStateBinding.composerMenuStateBinding.menuInitialPage}
      onClose={composerCommands.composerControlActionsBinding.closeControls}
      resources={composerInputs.workspaceResources}
      controlsResourceId={composerInputs.controlsResourceId}
      backgroundTerminalsResourceId={terminalInputs.backgroundTerminalsResourceId}
      goalResourceId={goalInputs.goalResourceId}
      tunnelResourceId={portsInputs.tunnelResourceId}
      portForwardingConnectionId={portsInputs.portForwardingConnectionId}
      portForwardingServerName={portsInputs.portForwardingServerName}
      {...(portsInputs.onOpenPortForward === undefined
        ? {}
        : { onOpenPortForward: portsInputs.onOpenPortForward })}
      controlError={composerStateBinding.composerEditingBinding.controlError}
      queuedPrompts={visibleQueuedPrompts}
      activeTurnId={timelineRead.conversationPresentationBinding.currentTurnId}
      voiceScope={composerScope}
      selectedModel={composerStateBinding.composerEditingBinding.selectedModel}
      selectedEffort={composerStateBinding.composerEditingBinding.selectedEffort}
      selectedPersonality={composerStateBinding.composerEditingBinding.selectedPersonality}
      selectedPermissions={composerStateBinding.composerEditingBinding.selectedPermissions}
      onSelectModel={composerStateBinding.composerEditingBinding.selectModel}
      onSelectEffort={composerStateBinding.composerEditingBinding.selectEffort}
      onSelectPersonality={composerStateBinding.composerEditingBinding.setSelectedPersonality}
      onSelectPermissions={composerStateBinding.composerEditingBinding.selectPermissions}
      onInvokeSkill={composerStateBinding.composerEditingBinding.insertSkillInvocation}
      {...(queueInputs.onEditQueued === undefined ||
      composerStateBinding.composerVoiceStateBinding.voicePhase !== "idle"
        ? {}
        : { onBeginQueuedEdit: composerCommands.queueEditActionsBinding.beginQueuedComposerEdit })}
      {...(queueInputs.onCancelQueued === undefined
        ? {}
        : { onCancelQueued: queueInputs.onCancelQueued })}
      {...(queueInputs.onMoveQueued === undefined
        ? {}
        : { onMoveQueued: queueInputs.onMoveQueued })}
      {...(queueInputs.onSteerQueued === undefined
        ? {}
        : { onSteerQueued: queueInputs.onSteerQueued })}
      {...(attachmentsInputs.getTransferAccess === undefined
        ? {}
        : { getTransferAccess: getStableTransferAccess })}
      {...(terminalInputs.onListTerminals === undefined
        ? {}
        : { onListTerminals: terminalInputs.onListTerminals })}
      {...(terminalInputs.onTerminateTerminal === undefined
        ? {}
        : { onTerminateTerminal: terminalInputs.onTerminateTerminal })}
      {...(goalInputs.onSetGoal === undefined ? {} : { onSetGoal: goalInputs.onSetGoal })}
      {...(goalInputs.onClearGoal === undefined ? {} : { onClearGoal: goalInputs.onClearGoal })}
      {...(reviewInputs.onStartReview === undefined
        ? {}
        : { onStartReview: reviewInputs.onStartReview })}
      {...(portsInputs.onCreateTunnel === undefined
        ? {}
        : { onCreateTunnel: portsInputs.onCreateTunnel })}
      {...(portsInputs.onRevokeTunnel === undefined
        ? {}
        : { onRevokeTunnel: portsInputs.onRevokeTunnel })}
    />
  );
  const projectPickerContent = (
    <ProjectPickerSheet
      visible={composerProjectSelectionBinding.projectPickerVisible}
      cwd={surfaceInputs.cwd}
      projects={projectsInputs.projects}
      discoveredProjects={projectsInputs.discoveredProjects}
      busy={composerProjectSelectionBinding.projectChangeBusy}
      error={composerProjectSelectionBinding.projectChangeError ?? projectsInputs.projectLoadError}
      onSelect={composerProjectSelectionBinding.selectProject}
      {...(projectsInputs.onAddProject === undefined
        ? {}
        : { onAddProject: projectsInputs.onAddProject })}
      {...(projectsInputs.onReadDirectory === undefined
        ? {}
        : { onReadDirectory: projectsInputs.onReadDirectory })}
      onClose={composerProjectSelectionBinding.closeProjectPicker}
      {...(onManageProjects === undefined
        ? {}
        : {
            onManageProjects: () => {
              composerProjectSelectionBinding.closeProjectPicker();
              onManageProjects();
            },
          })}
    />
  );
  const renameContent = (
    <ThreadRenameDialog
      visible={threadRenameBinding.threadRenameVisible}
      title={thread.title}
      onClose={threadRenameBinding.closeThreadRename}
      {...(actionsInputs.onRename === undefined ? {} : { onRename: actionsInputs.onRename })}
    />
  );
  const resourcesContent = (
    <ThreadResourcesSheet
      codePreviewMaxHeight={TOOL_RESULT_MAX_HEIGHT}
      visible={toolsBinding.attachmentVisibilityBinding.threadResourceSheet !== null}
      model={changesInputs.threadResourcesModel}
      resourceId={changesInputs.threadResourceId}
      revision={changesInputs.threadResourceRevision}
      cwd={surfaceInputs.cwd}
      thread={readInputs.remoteThread ?? null}
      voiceRuntime={appVoiceInputRuntime}
      getTransferAccess={getStableTransferAccess}
      onAttachReview={toolsBinding.reviewSubmissionBinding.attachCodeReview}
      {...(changesInputs.onLoadThreadChangeDiff === undefined
        ? {}
        : { onLoadThreadChangeDiff: changesInputs.onLoadThreadChangeDiff })}
      {...(onLoadThreadResources === undefined
        ? {}
        : { onReload: () => onLoadThreadResources(undefined, "attachments") })}
      onClose={toolsBinding.attachmentVisibilityBinding.closeThreadResources}
    />
  );
  return { reviewContent, menuContent, projectPickerContent, renameContent, resourcesContent };
}
