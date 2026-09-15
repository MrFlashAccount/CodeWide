import type { ConversationSurfaceCapabilities } from "./conversationSurfaceCapabilities";
import type { ConversationAgentCapabilities } from "../agents/conversationAgentCapabilities";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppFullscreenOverlayBoundary } from "../../ui/AppFullscreenOverlay";
import { AppVoiceInputProvider, type AppVoiceInputRuntime } from "../../ui/VoiceInputRuntime";
import { useComposerProjectSelection } from "../projects/composerProjectSelection";
import { useThreadRename } from "../turnActions/threadRename";
import { LargeContentViewerHost } from "./content/FullContentViewer";
import { createConversationChromeContent } from "./ConversationChromeContent";
import { useComposerState } from "../composer/composerState";
import { ConversationLayout } from "./ConversationLayout";
import { createConversationOverlayContent } from "./ConversationOverlayContent";
import { createConversationTimelineContent } from "./ConversationTimelineContent";
import { useConversationTools } from "./ConversationTools";
import { useConversationTimelineRead } from "./timeline/conversationTimelineRead";
import { useConversationTimelineState } from "./timeline/conversationTimelineState";
import { useOverlayScrollOwnership } from "./timeline/overlayScrollOwnership";
import { useConversationPaneGeometry } from "./timeline/timelineViewport";
import { SubagentNavigationContext } from "./turns/turnContexts";

export function createConversationFrame({
  appVoiceInputRuntime,
  composerScope,
  overlayScrollOwnershipBinding,
  agentsInputs,
  draftConnectionId,
  draftThreadId,
  toolsBinding,
  chromeView,
  conversationOverlayContentBinding,
  surfaceInputs,
  conversationPaneGeometryBinding,
  timelineState,
  conversationInsets,
  composerStateBinding,
  timelineView,
  timelineRead,
  composerProjectSelectionBinding,
  threadRenameBinding,
}: {
  appVoiceInputRuntime: AppVoiceInputRuntime;
  composerScope: string;
  overlayScrollOwnershipBinding: ReturnType<typeof useOverlayScrollOwnership>;
  agentsInputs: ConversationAgentCapabilities;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  toolsBinding: ReturnType<typeof useConversationTools>;
  chromeView: ReturnType<typeof createConversationChromeContent>;
  conversationOverlayContentBinding: ReturnType<typeof createConversationOverlayContent>;
  surfaceInputs: ConversationSurfaceCapabilities;
  conversationPaneGeometryBinding: ReturnType<typeof useConversationPaneGeometry>;
  timelineState: ReturnType<typeof useConversationTimelineState>;
  conversationInsets: ReturnType<typeof useSafeAreaInsets>;
  composerStateBinding: ReturnType<typeof useComposerState>;
  timelineView: ReturnType<typeof createConversationTimelineContent>;
  timelineRead: ReturnType<typeof useConversationTimelineRead>;
  composerProjectSelectionBinding: ReturnType<typeof useComposerProjectSelection>;
  threadRenameBinding: ReturnType<typeof useThreadRename>;
}) {
  const frame = (
    <AppVoiceInputProvider runtime={appVoiceInputRuntime}>
      <AppFullscreenOverlayBoundary
        scope={composerScope}
        lifecycle={overlayScrollOwnershipBinding.fullscreenOverlayLifecycle}
      >
        <SubagentNavigationContext.Provider
          value={
            agentsInputs.onOpenSubagentThread ??
            (draftConnectionId !== null &&
            draftThreadId !== null &&
            agentsInputs.subagentThreadDetails !== null
              ? (threadId) =>
                  toolsBinding.openSubagents(toolsBinding.currentSubagentSummaries(), threadId)
              : null)
          }
        >
          <LargeContentViewerHost>
            <ConversationLayout
              searchContent={chromeView.searchContent}
              jumpContent={chromeView.jumpContent}
              menuContent={conversationOverlayContentBinding.menuContent}
              projectPickerContent={conversationOverlayContentBinding.projectPickerContent}
              renameContent={conversationOverlayContentBinding.renameContent}
              resourcesContent={conversationOverlayContentBinding.resourcesContent}
              compact={surfaceInputs.compact}
              setConversationPaneHeight={conversationPaneGeometryBinding.setConversationPaneHeight}
              setNarrowConversationPane={conversationPaneGeometryBinding.setNarrowConversationPane}
              headerContent={chromeView.headerContent}
              threadSearchVisible={timelineState.timelineSearchStateBinding.threadSearchVisible}
              conversationInsets={conversationInsets}
              setComposerTrayVisible={
                composerStateBinding.composerMenuStateBinding.setComposerTrayVisible
              }
              cwd={surfaceInputs.cwd}
              openCodeDocument={toolsBinding.changesFeatureBinding.openCodeDocument}
              presentTurnChanges={toolsBinding.changesFeatureBinding.presentTurnChanges}
              timelineSurface={timelineView.timelineSurface}
              conversationBackdropVisible={timelineRead.conversationBackdropVisible}
              awayFromLatest={timelineState.historyAnchorStateBinding.awayFromLatest}
              bottomChrome={chromeView.bottomChrome}
              reviewContent={conversationOverlayContentBinding.reviewContent}
              menuVisible={composerStateBinding.composerMenuStateBinding.menuVisible}
              projectPickerVisible={composerProjectSelectionBinding.projectPickerVisible}
              threadRenameVisible={threadRenameBinding.threadRenameVisible}
              resourcesVisible={
                toolsBinding.attachmentVisibilityBinding.threadResourceSheet !== null
              }
            />
          </LargeContentViewerHost>
        </SubagentNavigationContext.Provider>
      </AppFullscreenOverlayBoundary>
    </AppVoiceInputProvider>
  );
  return { frame };
}
