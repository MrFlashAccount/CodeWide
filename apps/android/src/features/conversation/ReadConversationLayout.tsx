import type { ReactElement } from "react";
import { AppFullscreenOverlayBoundary } from "../../ui/AppFullscreenOverlay";
import { AppVoiceInputProvider } from "../../ui/VoiceInputRuntime";
import { LargeContentViewerHost } from "./content/FullContentViewer";
import { ConversationBottomChrome } from "./ConversationBottomChrome";
import { ConversationLayout } from "./ConversationLayout";
import type { ConversationReadSurfaceProps } from "./conversationReadCapabilities";
import type { useReadConversationTimelineBindings } from "./readConversationTimelineBindings";
import { JumpToLatest } from "./timeline/JumpToLatest";
import { TimelineSearchBar } from "./timeline/TimelineSearchBar";
import { SubagentNavigationContext } from "./turns/turnContexts";

/** Read-only layout composes the existing timeline and overlay scopes without owning editor state. */
export function renderReadConversationLayout({
  headerContent,
  props,
  read,
  timelinePositioned,
  timelineSurface,
}: {
  headerContent: ReactElement;
  props: ConversationReadSurfaceProps;
  read: ReturnType<typeof useReadConversationTimelineBindings>;
  timelinePositioned: boolean;
  timelineSurface: ReactElement;
}) {
  return (
    <AppVoiceInputProvider runtime={props.appVoiceInputRuntime}>
      <AppFullscreenOverlayBoundary
        lifecycle={props.overlay.fullscreenOverlayLifecycle}
        scope={read.composerScope}
      >
        <SubagentNavigationContext.Provider value={props.onOpenSubagentThread}>
          <LargeContentViewerHost>
            <ConversationLayout
              awayFromLatest={read.anchor.awayFromLatest}
              bottomChrome={
                <ConversationBottomChrome
                  composerContent={props.footerContent}
                  currentOutcome={null}
                  failureNotice={read.presentation.failureNotice}
                  readOnly
                  remoteThread={props.remoteThread}
                  requestPrompt={null}
                  setBottomChromeHeight={props.viewport.setBottomChromeHeight}
                  timeline={read.timeline}
                />
              }
              compact={props.compact}
              conversationBackdropVisible={timelinePositioned && read.timeline.length > 0}
              conversationInsets={read.conversationInsets}
              cwd={props.remoteThread.cwd}
              headerContent={headerContent}
              jumpContent={
                <JumpToLatest
                  bottomChromeHeight={props.viewport.bottomChromeHeight}
                  jumpTimelineToLatest={read.anchorActions.jumpTimelineToLatest}
                  newItemCount={0}
                />
              }
              openCodeDocument={props.openCodeDocument}
              presentTurnChanges={props.presentTurnChanges}
              projectPickerContent={<></>}
              projectPickerVisible={false}
              renameContent={<></>}
              reviewContent={props.reviewContent}
              searchContent={
                <TimelineSearchBar
                  {...read.search}
                  {...read.searchProjection}
                  {...read.searchActions}
                  compact={props.compact}
                />
              }
              setComposerTrayVisible={() => undefined}
              setConversationPaneHeight={read.setPaneHeight}
              setNarrowConversationPane={read.setNarrow}
              threadRenameVisible={false}
              threadSearchVisible={read.search.threadSearchVisible}
              timelineSurface={timelineSurface}
            />
          </LargeContentViewerHost>
        </SubagentNavigationContext.Provider>
      </AppFullscreenOverlayBoundary>
    </AppVoiceInputProvider>
  );
}
