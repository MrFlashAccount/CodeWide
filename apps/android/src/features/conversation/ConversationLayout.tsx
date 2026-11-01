import { StyleSheet, View } from "react-native";
import { KeyboardGestureArea, KeyboardStickyView } from "react-native-keyboard-controller";
import { ThreadCodeDocumentContext } from "../../rendering/ThreadCodeDocumentContext";
import { TurnChangesContext } from "../../rendering/TurnChangesContext";
import { conversationHeaderChromeHeight } from "../../ui/conversation-chrome-layout";
import { ConversationPanelUnderlay } from "../../ui/ConversationPanelUnderlay";
import { MessageActionMenuProvider } from "../../ui/MessageActionMenu";
import { PaneChrome } from "../../ui/PaneChrome";
import { surfaceToneCanvasStyle, useSurfaceTone } from "../../ui/surfaceTone";
import { CostBreakdownMenuProvider } from "../accounts/CostBreakdownMenu";
import { styles } from "./ConversationLayout.styles";
import type { ConversationLayoutProps } from "./ConversationLayoutContract";
import { ThreadCwdContext } from "./turns/turnContexts";

export function ConversationLayout({
  bottomChrome,
  conversationInsets,
  cwd,
  headerContent,
  jumpContent,
  openCodeDocument,
  presentTurnChanges,
  projectPickerContent,
  projectPickerVisible,
  renameContent,
  reviewContent,
  searchContent,
  setComposerTrayVisible,
  setConversationPaneHeight,
  setNarrowConversationPane,
  threadRenameVisible,
  threadSearchVisible,
  timelineSurface,
}: ConversationLayoutProps) {
  // A host pane on the recessed workspace frame paints the conversation in the frame color.
  const canvas = surfaceToneCanvasStyle(useSurfaceTone());
  return (
    <ThreadCodeDocumentContext.Provider value={openCodeDocument}>
      <View
        onLayout={({ nativeEvent }) => {
          const paneWidth = Math.max(0, Math.floor(nativeEvent.layout.width));
          const paneHeight = Math.max(0, Math.floor(nativeEvent.layout.height));
          setConversationPaneHeight((current) => (current === paneHeight ? current : paneHeight));
          const next = paneWidth < 520;
          setNarrowConversationPane((current) => (current === next ? current : next));
        }}
        style={[styles.conversation, canvas]}
        testID="thread-detail-pane-shell"
      >
        <View style={[styles.conversationKeyboard, canvas]} testID="thread-detail-pane">
          <View pointerEvents="box-none" style={styles.conversationHeaderChrome}>
            {headerContent}

            {threadSearchVisible && <PaneChrome>{searchContent}</PaneChrome>}
          </View>

          <View style={styles.conversationContentSurface}>
            <KeyboardGestureArea
              enableSwipeToDismiss
              interpolator="ios"
              offset={conversationInsets.bottom}
              onTouchStart={() => {
                setComposerTrayVisible(false);
              }}
              style={[styles.conversationKeyboardBody, canvas]}
            >
              <ThreadCwdContext.Provider value={cwd}>
                <TurnChangesContext.Provider value={presentTurnChanges}>
                  <MessageActionMenuProvider>
                    <CostBreakdownMenuProvider>{timelineSurface}</CostBreakdownMenuProvider>
                  </MessageActionMenuProvider>
                </TurnChangesContext.Provider>
              </ThreadCwdContext.Provider>
            </KeyboardGestureArea>
          </View>

          <ConversationPanelUnderlay
            style={[
              styles.conversationHeaderUnderlay,
              { height: conversationHeaderChromeHeight(threadSearchVisible) },
            ]}
          />

          <KeyboardStickyView
            enabled
            offset={{ closed: 0, opened: conversationInsets.bottom }}
            style={styles.composerSticky}
          >
            <ConversationPanelUnderlay style={StyleSheet.absoluteFill} />
            {/* The floating jump control keeps its inset from the pane's visible edge. */}
            <PaneChrome pointerEvents="box-none" style={StyleSheet.absoluteFill}>
              {jumpContent}
            </PaneChrome>

            {bottomChrome}
          </KeyboardStickyView>

          {reviewContent}

          {projectPickerVisible && projectPickerContent}
          {threadRenameVisible && renameContent}
        </View>
      </View>
    </ThreadCodeDocumentContext.Provider>
  );
}
