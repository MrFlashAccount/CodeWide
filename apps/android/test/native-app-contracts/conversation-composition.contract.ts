import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  ownerConversationDetail,
  conversationLayout,
  conversationOverlay,
  ownerConversationLayout,
  ownerConversationWorkspaceContent,
  ownerConversationWorkspace,
  ownerConversationTools,
  ownerConversationHistoryStatus,
  conversationAdapter,
  conversationLayoutStyles,
  ownerConversationScopeBindings,
} from "./conversation-composition-sources";

const ownerMainConversationPublication = readFileSync(new URL("../../src/features/conversation/MainConversationPublication.tsx", import.meta.url), "utf8");
const ownerActiveConversationScope = readFileSync(new URL("../../src/features/conversation/activeConversationScope.ts", import.meta.url), "utf8");
const ownerConversationDestinationSurface = readFileSync(new URL("../../src/features/conversation/ConversationDestinationSurface.tsx", import.meta.url), "utf8");
const ownerMainConversationHistory = readFileSync(new URL("../../src/features/conversation/mainConversationHistory.ts", import.meta.url), "utf8");

it("preserves conversation composition integration contracts", () => {
  expect(ownerMainConversationPublication).toContain("queuedPrompts: history.projection.queuedPrompts");
  expect(conversationLayout).not.toContain("menuVisible");
  expect(conversationOverlay).not.toContain("ComposerMenuComposition");
  expect(conversationLayout).toContain("{projectPickerVisible && projectPickerContent}");
  expect(conversationOverlay).toContain("<ProjectPickerSheet");
  expect(conversationLayout).toContain("{threadRenameVisible && renameContent}");
  expect(conversationOverlay).toContain("<ThreadRenameDialog");
  expect(conversationLayout).not.toContain("resourcesVisible");
  expect(ownerConversationTools).toContain("routeNavigation.openAttachments");
  expect(ownerConversationLayout).toContain("<MessageActionMenuProvider>");
  expect(ownerConversationWorkspaceContent).toContain("onStartVoiceTranscription");
  expect(ownerActiveConversationScope).toContain("&& selectedThread === null;");
  expect(ownerConversationDestinationSurface).not.toContain("defaultDesktopThreadId");
  expect(ownerConversationTools).toContain(
    "useImagePreviewAnnotationHandler(drawingFeatureBinding.annotateImage)",
  );
  expect(ownerConversationHistoryStatus).toContain("function ConversationHistorySubtitle(");
  expect(ownerConversationHistoryStatus).toContain(
    "const activity = useThreadHistoryActivity(model, resourceId)",
  );
  expect(ownerConversationHistoryStatus).toContain(
    'const connecting = server?.status === "connecting"',
  );
  expect(ownerConversationHistoryStatus).toContain('activity.status !== "loading-history"');
  expect(ownerConversationHistoryStatus).toContain('activity.status === "background-retrying"');
  expect(ownerConversationHistoryStatus).toContain('testID="history-loading-indicator"');
  expect(ownerConversationHistoryStatus).toContain(
    "style={[styles.conversationSubtitle, { color }]}",
  );
  expect(conversationOverlay).toContain("{thread.title}");
  expect(conversationAdapter).toContain("getOrCreateThreadUiState");
  expect(ownerConversationDetail).toContain(
    "const chatWindow = useThreadChatWindow(chatDatabase, chatWindowRequest, false)",
  );
  expect(ownerConversationWorkspace).toContain("connectionId: scope.activeConnectionId");
  expect(ownerConversationWorkspace).toContain("threadId: scope.activeRemoteThreadId");
  expect(ownerConversationLayout).toContain("KeyboardStickyView");
  expect(ownerConversationLayout).toContain("KeyboardGestureArea");
  expect(ownerConversationLayout).toMatch(
    /<\/ThreadCwdContext\.Provider>\s*<\/KeyboardGestureArea>\s*<\/View>/,
  );
  expect(ownerConversationLayout).toContain("<ConversationPanelUnderlay");
  expect(ownerConversationLayout).toContain(
    "<ConversationPanelUnderlay style={StyleSheet.absoluteFill} />",
  );
  expect(ownerConversationLayout).toContain(
    "offset={{ closed: 0, opened: conversationInsets.bottom }}",
  );
  expect(ownerConversationWorkspaceContent).toContain("onViewedLatest: props.markActiveThreadRead");
  expect(ownerMainConversationPublication).toContain(
    "const items = await resources.loadTurnItems(connectionId, threadId, turnId)",
  );
  expect(ownerMainConversationPublication).toContain("searchWindow?.replaceItems(turnId, items)");
  expect(ownerConversationLayout).toMatch(/<KeyboardStickyView\s+enabled/);
  expect(ownerConversationLayout).toContain('testID="thread-detail-pane-shell"');
  expect(ownerConversationLayout).toMatch(
    /const paneWidth = Math\.max\(0, Math\.floor\(nativeEvent\.layout\.width\)\)/,
  );
  expect(ownerConversationLayout).toContain("const next = paneWidth < 520");
  expect(ownerConversationLayout).toContain("style={styles.conversationKeyboard}");
  expect(conversationLayoutStyles).toMatch(
    /conversationKeyboard: \{\s*flex: 1,\s*minWidth: 0,\s*alignSelf: "stretch"/,
  );
  expect(ownerConversationWorkspaceContent).toContain(
    "threadResourcesModel: props.runtime.resources?.threadResources ?? null",
  );
  expect(ownerConversationTools).toContain("<ThreadResourceContextChips");
  expect(ownerConversationScopeBindings).toMatch(
    /onLoadThreadResources: async \(\s*scope\?: ThreadChangeScope,\s*kind\?: "all" \| "changes" \| "attachments",?\s*\) =>\s*await features\.changes\.loadThreadResources\(/,
  );
  expect(ownerConversationWorkspaceContent).toContain(
    "threadResourceRevision: props.activeConnectionState",
  );
  expect(ownerConversationDestinationSurface).toContain("activeConnectionState");
  expect(ownerConversationDetail).toContain(
    "const chatWindow = useThreadChatWindow(chatDatabase, chatWindowRequest, false)",
  );
  expect(ownerConversationDetail).toContain(
    "const [initialHistoryAnchorTurnId, setHistoryAnchorTurnId] = useConversationState(",
  );
  expect(ownerConversationDetail).toMatch(
    /\(\) => composerState\.historyAnchorTurnId \?\? null,?\s*\)/,
  );
  expect(ownerConversationDetail).toContain(
    "anchorTurnId: searchWindow === null ? initialHistoryAnchorTurnId : null",
  );
  expect(ownerConversationDetail).toContain(
    "anchorTurnId: searchWindow === null ? initialHistoryAnchorTurnId : null",
  );
  expect(ownerConversationDetail.indexOf("const composerState = useThreadUiState")).toBeLessThan(
    ownerConversationDetail.indexOf(
      "const chatWindow = useThreadChatWindow(chatDatabase, chatWindowRequest, false)",
    ),
  );
  expect(ownerMainConversationHistory).toContain(
    "status: remoteThread === null ? \"initial-loading\" : \"ready\"",
  );
  expect(ownerConversationWorkspaceContent).toContain(
    "threadResourceRevision: props.activeConnectionState",
  );
});
