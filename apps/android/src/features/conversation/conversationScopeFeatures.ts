import {
  useChangeResourcePresentation,
  useChangesPreferences,
} from "../changes/changePresentation";
import { useComposerState } from "../composer/composerState";
import { useGoalResource } from "../goal/goalResource";
import { useComposerProjectSelection } from "../projects/composerProjectSelection";
import { useQueueVisibility } from "../queue/queueVisibility";
import { useThreadRename } from "../turnActions/threadRename";
import { useConversationActivation } from "./conversationActivation";
import type { ConversationCompositionCapabilities } from "./conversationCompositionCapabilities";
import { useConversationTimelineState } from "./timeline/conversationTimelineState";
import {
  useOverlayScrollOwnership,
  useOverlayScrollState,
} from "./timeline/overlayScrollOwnership";
import { usePaginationTrim } from "./timeline/timelineViewport";

/** Binds existing scoped owners in their original hook order; owns no replacement state. */
export function useConversationScopeFeatures(props: {
  surfaceInputs: ConversationCompositionCapabilities["surface"];
  readInputs: ConversationCompositionCapabilities["read"];
  composerInputs: ConversationCompositionCapabilities["composer"];
  goalInputs: ConversationCompositionCapabilities["goal"];
  queueInputs: ConversationCompositionCapabilities["queue"];
  changesInputs: ConversationCompositionCapabilities["changes"];
  projectsInputs: ConversationCompositionCapabilities["projects"];
}) {
  const activation = useConversationActivation({
    surfaceInputs: props.surfaceInputs,
    readInputs: props.readInputs,
    composerInputs: props.composerInputs,
  });
  const composerStateBinding = useComposerState({
    composerScope: activation.composerScope,
    workspaceResources: props.composerInputs.workspaceResources,
    draftConnectionId: activation.draftConnectionId,
    draftThreadId: activation.draftThreadId,
    composerState: props.readInputs.composerState,
    newChat: props.surfaceInputs.newChat,
    cwd: props.surfaceInputs.cwd,
    controlsResourceId: props.composerInputs.controlsResourceId,
    conversationOwner: activation.conversationOwner,
    composerInputs: props.composerInputs,
    voiceController: props.composerInputs.voiceController,
  });
  const changesPreferencesBinding = useChangesPreferences(activation.composerScope);
  const goalResource = useGoalResource(
    props.composerInputs.workspaceResources,
    props.goalInputs.goalResourceId,
    props.goalInputs.onGetGoal,
  );
  const queueVisibilityBinding = useQueueVisibility(
    activation.composerScope,
    props.queueInputs.queuedPrompts,
    composerStateBinding.composerMenuStateBinding.setMenuVisible,
  );
  const changeResourcePresentationBinding = useChangeResourcePresentation(
    props.changesInputs.threadResourcesModel,
    props.changesInputs.threadResourceId,
    changesPreferencesBinding.changesPreferences,
  );
  const threadRenameBinding = useThreadRename(activation.composerScope);
  const timelineState = useConversationTimelineState({
    composerScope: activation.composerScope,
    searchWindow: props.readInputs.searchWindow,
    composerState: props.readInputs.composerState,
    draftConnectionId: activation.draftConnectionId,
    draftThreadId: activation.draftThreadId,
    readInputs: props.readInputs,
  });
  const overlayScrollStateBinding = useOverlayScrollState();
  const paginationTrimBinding = usePaginationTrim({
    paginationTrimTimerRef: timelineState.timelineViewportStateBinding.paginationTrimTimerRef,
    paginationEdgeLockRef: timelineState.timelineViewportStateBinding.paginationEdgeLockRef,
    fullscreenScrollOwnership: overlayScrollStateBinding.fullscreenScrollOwnership,
    historyViewport: props.readInputs.historyViewport,
  });
  const overlayScrollOwnershipBinding = useOverlayScrollOwnership(
    activation.composerScope,
    overlayScrollStateBinding.fullscreenScrollOwnership,
    paginationTrimBinding.cancelScheduledPaginationTrim,
  );
  const composerProjectSelectionBinding = useComposerProjectSelection(
    activation.composerScope,
    props.projectsInputs.onChangeProject,
    overlayScrollOwnershipBinding.dismissComposerKeyboardForOverlay,
    activation.conversationOwner,
  );
  return {
    activation,
    composerStateBinding,
    changesPreferencesBinding,
    goalResource,
    queueVisibilityBinding,
    changeResourcePresentationBinding,
    threadRenameBinding,
    timelineState,
    overlayScrollStateBinding,
    paginationTrimBinding,
    overlayScrollOwnershipBinding,
    composerProjectSelectionBinding,
  };
}
