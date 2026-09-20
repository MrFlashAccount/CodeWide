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
  changesInputs: ConversationCompositionCapabilities["changes"];
  composerInputs: ConversationCompositionCapabilities["composer"];
  goalInputs: ConversationCompositionCapabilities["goal"];
  projectsInputs: ConversationCompositionCapabilities["projects"];
  queueInputs: ConversationCompositionCapabilities["queue"];
  readInputs: ConversationCompositionCapabilities["read"];
  surfaceInputs: ConversationCompositionCapabilities["surface"];
}) {
  const activation = useConversationActivation({
    composerInputs: props.composerInputs,
    readInputs: props.readInputs,
    surfaceInputs: props.surfaceInputs,
  });
  const composerStateBinding = useComposerState({
    composerInputs: props.composerInputs,
    composerScope: activation.composerScope,
    composerState: props.readInputs.composerState,
    controlsResourceId: props.composerInputs.controlsResourceId,
    conversationOwner: activation.conversationOwner,
    cwd: props.surfaceInputs.cwd,
    draftConnectionId: activation.draftConnectionId,
    draftThreadId: activation.draftThreadId,
    newChat: props.surfaceInputs.newChat,
    voiceController: props.composerInputs.voiceController,
    workspaceResources: props.composerInputs.workspaceResources,
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
  );
  const changeResourcePresentationBinding = useChangeResourcePresentation(
    props.changesInputs.threadResourcesModel,
    props.changesInputs.threadResourceId,
    changesPreferencesBinding.changesPreferences,
  );
  const threadRenameBinding = useThreadRename(activation.composerScope);
  const timelineState = useConversationTimelineState({
    composerScope: activation.composerScope,
    draftConnectionId: activation.draftConnectionId,
    draftThreadId: activation.draftThreadId,
    readInputs: props.readInputs,
    searchWindow: props.readInputs.searchWindow,
  });
  const overlayScrollStateBinding = useOverlayScrollState();
  const paginationTrimBinding = usePaginationTrim({
    fullscreenScrollOwnership: overlayScrollStateBinding.fullscreenScrollOwnership,
    historyViewport: props.readInputs.historyViewport,
    paginationEdgeLockRef: timelineState.timelineViewportStateBinding.paginationEdgeLockRef,
    paginationTrimTimerRef: timelineState.timelineViewportStateBinding.paginationTrimTimerRef,
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
    changeResourcePresentationBinding,
    changesPreferencesBinding,
    composerProjectSelectionBinding,
    composerStateBinding,
    goalResource,
    overlayScrollOwnershipBinding,
    overlayScrollStateBinding,
    paginationTrimBinding,
    queueVisibilityBinding,
    threadRenameBinding,
    timelineState,
  };
}
