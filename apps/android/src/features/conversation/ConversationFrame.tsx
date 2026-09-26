import type { ConversationSurfaceCapabilities } from "./conversationSurfaceCapabilities";
import type { ConversationAgentCapabilities } from "../agents/conversationAgentCapabilities";
import type { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppFullscreenOverlayBoundary } from "../../ui/AppFullscreenOverlay";
import { AppVoiceInputProvider, type AppVoiceInputRuntime } from "../../ui/VoiceInputRuntime";
import type { useComposerProjectSelection } from "../projects/composerProjectSelection";
import type { useThreadRename } from "../turnActions/threadRename";
import { LargeContentViewerHost } from "./content/FullContentViewer";
import type { createConversationChromeContent } from "./ConversationChromeContent";
import type { useComposerState } from "../composer/composerState";
import { ConversationLayout } from "./ConversationLayout";
import type { createConversationOverlayContent } from "./ConversationOverlayContent";
import type { createConversationTimelineContent } from "./ConversationTimelineContent";
import type { useConversationTools } from "./ConversationTools";
import type { useConversationTimelineRead } from "./timeline/conversationTimelineRead";
import type { useConversationTimelineState } from "./timeline/conversationTimelineState";
import type { useOverlayScrollOwnership } from "./timeline/overlayScrollOwnership";
import type { useConversationPaneGeometry } from "./timeline/timelineViewport";
import { SubagentNavigationContext } from "./turns/turnContexts";

export function createConversationFrame({
  agentsInputs,
  appVoiceInputRuntime,
  chromeView,
  composerProjectSelectionBinding,
  composerScope,
  composerStateBinding,
  conversationInsets,
  conversationOverlayContentBinding,
  conversationPaneGeometryBinding,
  draftConnectionId,
  draftThreadId,
  overlayScrollOwnershipBinding,
  surfaceInputs,
  threadRenameBinding,
  timelineRead,
  timelineState,
  timelineView,
  toolsBinding,
}: {
  agentsInputs: ConversationAgentCapabilities;
  appVoiceInputRuntime: AppVoiceInputRuntime;
  chromeView: ReturnType<typeof createConversationChromeContent>;
  composerProjectSelectionBinding: ReturnType<typeof useComposerProjectSelection>;
  composerScope: string;
  composerStateBinding: ReturnType<typeof useComposerState>;
  conversationInsets: ReturnType<typeof useSafeAreaInsets>;
  conversationOverlayContentBinding: ReturnType<typeof createConversationOverlayContent>;
  conversationPaneGeometryBinding: ReturnType<typeof useConversationPaneGeometry>;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  overlayScrollOwnershipBinding: ReturnType<typeof useOverlayScrollOwnership>;
  surfaceInputs: ConversationSurfaceCapabilities;
  threadRenameBinding: ReturnType<typeof useThreadRename>;
  timelineRead: ReturnType<typeof useConversationTimelineRead>;
  timelineState: ReturnType<typeof useConversationTimelineState>;
  timelineView: ReturnType<typeof createConversationTimelineContent>;
  toolsBinding: ReturnType<typeof useConversationTools>;
}) {
  const frame = (
    <AppVoiceInputProvider runtime={appVoiceInputRuntime}>
      <AppFullscreenOverlayBoundary
        lifecycle={overlayScrollOwnershipBinding.fullscreenOverlayLifecycle}
        scope={composerScope}
      >
        <SubagentNavigationContext.Provider
          value={
            agentsInputs.onOpenSubagentThread ??
            (draftConnectionId !== null &&
            draftThreadId !== null &&
            agentsInputs.subagentThreadDetails !== null
              ? (threadId) => {
                  toolsBinding.openSubagents(toolsBinding.currentSubagentSummaries(), threadId);
                }
              : null)
          }
        >
          <LargeContentViewerHost>
            <ConversationLayout
              bottomChrome={chromeView.bottomChrome}
              compact={surfaceInputs.compact}
              conversationBackdropVisible={timelineRead.conversationBackdropVisible}
              conversationInsets={conversationInsets}
              cwd={surfaceInputs.cwd}
              headerContent={chromeView.headerContent}
              jumpContent={chromeView.jumpContent}
              openCodeDocument={toolsBinding.openTimelineDocument}
              presentTurnChanges={toolsBinding.changesFeatureBinding.presentTurnChanges}
              projectPickerContent={conversationOverlayContentBinding.projectPickerContent}
              projectPickerVisible={composerProjectSelectionBinding.projectPickerVisible}
              renameContent={conversationOverlayContentBinding.renameContent}
              reviewContent={conversationOverlayContentBinding.reviewContent}
              searchContent={chromeView.searchContent}
              setComposerTrayVisible={
                composerStateBinding.composerMenuStateBinding.setComposerTrayVisible
              }
              setConversationPaneHeight={conversationPaneGeometryBinding.setConversationPaneHeight}
              setNarrowConversationPane={conversationPaneGeometryBinding.setNarrowConversationPane}
              threadRenameVisible={threadRenameBinding.threadRenameVisible}
              threadSearchVisible={timelineState.timelineSearchStateBinding.threadSearchVisible}
              timelineSurface={timelineView.timelineSurface}
            />
          </LargeContentViewerHost>
        </SubagentNavigationContext.Provider>
      </AppFullscreenOverlayBoundary>
    </AppVoiceInputProvider>
  );
  return { frame };
}
