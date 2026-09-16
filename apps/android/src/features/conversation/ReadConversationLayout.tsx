import type { ReactElement } from "react";
import { AppFullscreenOverlayBoundary } from "../../ui/AppFullscreenOverlay";
import { AppVoiceInputProvider } from "../../ui/VoiceInputRuntime";
import { LargeContentViewerHost } from "./content/FullContentViewer";
import { ConversationBottomChrome } from "./ConversationBottomChrome";
import { ConversationLayout } from "./ConversationLayout";
import type { ConversationReadSurfaceProps } from "./conversationReadCapabilities";
import { useReadConversationTimelineBindings } from "./readConversationTimelineBindings";
import { JumpToLatest } from "./timeline/JumpToLatest";
import { TimelineSearchBar } from "./timeline/TimelineSearchBar";
import { SubagentNavigationContext } from "./turns/turnContexts";

/** Read-only layout composes the existing timeline and overlay scopes without owning editor state. */
export function renderReadConversationLayout({
  props,
  read,
  headerContent,
  timelineSurface,
  timelinePositioned,
}: {
  props: ConversationReadSurfaceProps;
  read: ReturnType<typeof useReadConversationTimelineBindings>;
  headerContent: ReactElement;
  timelineSurface: ReactElement;
  timelinePositioned: boolean;
}) {
  return (
    <AppVoiceInputProvider runtime={props.appVoiceInputRuntime}>
      <AppFullscreenOverlayBoundary
        scope={read.composerScope}
        lifecycle={props.overlay.fullscreenOverlayLifecycle}
      >
        <SubagentNavigationContext.Provider value={props.onOpenSubagentThread}>
          <LargeContentViewerHost>
            <ConversationLayout
              compact={props.compact}
              setConversationPaneHeight={read.setPaneHeight}
              setNarrowConversationPane={read.setNarrow}
              headerContent={headerContent}
              threadSearchVisible={read.search.threadSearchVisible}
              conversationInsets={read.conversationInsets}
              setComposerTrayVisible={() => undefined}
              cwd={props.remoteThread.cwd}
              openCodeDocument={props.openCodeDocument}
              presentTurnChanges={props.presentTurnChanges}
              timelineSurface={timelineSurface}
              conversationBackdropVisible={timelinePositioned && read.timeline.length > 0}
              awayFromLatest={read.anchor.awayFromLatest}
              reviewContent={props.reviewContent}
              projectPickerVisible={false}
              threadRenameVisible={false}
              projectPickerContent={<></>}
              renameContent={<></>}
              searchContent={
                <TimelineSearchBar
                  {...read.search}
                  {...read.searchProjection}
                  {...read.searchActions}
                  compact={props.compact}
                />
              }
              jumpContent={
                <JumpToLatest
                  newItemCount={0}
                  bottomChromeHeight={props.viewport.bottomChromeHeight}
                  jumpTimelineToLatest={read.anchorActions.jumpTimelineToLatest}
                />
              }
              bottomChrome={
                <ConversationBottomChrome
                  setBottomChromeHeight={props.viewport.setBottomChromeHeight}
                  readOnly
                  requestPrompt={null}
                  timeline={read.timeline}
                  failureNotice={read.presentation.failureNotice}
                  remoteThread={props.remoteThread}
                  currentOutcome={null}
                  composerContent={props.footerContent}
                />
              }
            />
          </LargeContentViewerHost>
        </SubagentNavigationContext.Provider>
      </AppFullscreenOverlayBoundary>
    </AppVoiceInputProvider>
  );
}
