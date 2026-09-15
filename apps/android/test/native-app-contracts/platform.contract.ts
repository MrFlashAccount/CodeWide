import { expect, it } from "vitest";
import {
  screen,
  imagePreviewHost,
  timelineList,
  richMarkdown,
  nativeCodeBlock,
  nativeCodeBlockHost,
  mermaidNative,
  documentPreviewHost,
} from "./platform-sources";

it("preserves platform integration contracts — 1", () => {
  expect(screen).not.toContain('accessibilityLabel="Attach to queued prompt"');
  expect(screen).not.toContain('accessibilityLabel="Move queued prompt up"');
  expect(screen).not.toContain('accessibilityLabel="Move queued prompt down"');
  expect(screen).not.toContain("styles.pendingDelivery");
  expect(screen).not.toContain("submissionHandoffs");
  expect(screen).not.toContain("Saved on this device. Waiting for the connection to recover");
  expect(screen).not.toContain("remote.queueDatabase.collection");
  expect(screen).not.toContain("queuedPromptState");
  expect(screen).not.toContain("voiceSessionPromiseRef");
  expect(screen).not.toContain("function BottomSheetSurface");
  expect(screen).not.toContain("<MenuView");
  expect(screen).not.toContain("function MessageContextMenu");
  expect(screen).not.toContain(
    "sheetTitle: { minWidth: 0, flexShrink: 1, color: colors.text, ...typeScale.titleLarge, marginBottom:",
  );
  expect(screen).not.toContain("ThreadListScrollGestureContext");
  expect(screen).not.toContain("simultaneousWithExternalGesture");
  expect(screen).not.toContain("renderScrollComponent={ThreadListScrollView}");
  expect(screen).not.toContain('from "heroui-native/menu"');
  expect(screen).not.toContain("function ThreadFilterSheet(");
  expect(screen).not.toContain("connectionSettingsList");
  expect(screen).not.toContain("Alert.alert(");
  expect(screen).not.toContain('from "./ui/AnimatedDisclosure"');
  expect(screen).not.toContain("stopVoiceRef");
  expect(screen).not.toContain("styles.streamingCodexBubble");
  expect(screen).not.toContain("pendingThreadSelectionsRef");
  expect(screen).not.toContain("selectedThread ?? (desktop && !pendingThreadSelection");
  expect(screen).not.toContain('Dimensions.addEventListener("change"');
  expect(screen).not.toContain("useWindowDimensions");
  expect(screen).not.toContain("serverEmoji?: string");
  expect(screen).not.toContain("styles.threadAvatar");
  expect(screen).not.toContain("effectiveTurnLifecycleStatus");
  expect(screen).not.toContain("normalizeTurn(");
  expect(imagePreviewHost).toContain("Owns preview state above the virtualized timeline");
  expect(imagePreviewHost).toContain("fullscreen.present(({ close }) => (");
  expect(imagePreviewHost).not.toContain("<Modal");
  expect(imagePreviewHost).toContain("styles.overlay");
  expect(imagePreviewHost).toContain("Gesture.Pinch()");
  expect(imagePreviewHost).not.toContain("withSpring");
  expect(imagePreviewHost).toContain("Annotate image in QuickDraw");
  expect(imagePreviewHost).not.toContain("Attach image review");
  expect(screen).not.toContain("codex-image-review-");
  expect(timelineList).toContain(
    "maintainScrollAtEnd={followTail ? TIMELINE_TAIL_FOLLOW_CONFIG : false}",
  );
  expect(timelineList).toContain("maintainScrollAtEndThreshold={TIMELINE_TAIL_FOLLOW_THRESHOLD}");
  expect(timelineList).not.toContain("androidScrollEdges");
  expect(timelineList).not.toContain("fadingEdgeLength");
  expect(timelineList).toContain("showsHorizontalScrollIndicator={false}");
  expect(timelineList).toContain("showsVerticalScrollIndicator={false}");
  expect(timelineList).toContain("dataChange: true");
  expect(timelineList).toContain("itemLayout: true");
  expect(timelineList).not.toContain("footerLayout: true");
  expect(timelineList).not.toContain("layout: true");
  expect(screen).not.toContain("autoscrollToBottomThreshold");
  expect(richMarkdown).toContain("const openImagePreview = useImagePreview()");
  expect(richMarkdown).not.toContain("<Modal visible={open}");
  expect(screen).not.toContain("<Modal visible={open}");
  expect(richMarkdown).toContain("accessibilityLabel={`Copy ${language} code block`}");
  expect(richMarkdown).toContain("<NativeCodeBlock value={value} language={language} />");
  expect(nativeCodeBlock).toContain(
    'import { NativeCodeBlockHost } from "../presentation/nativeCodeBlockHost";',
  );
  expect(nativeCodeBlockHost).toContain(
    'requireNativeComponent<NativeCodeBlockHostProps>("CodexNativeCodeBlock")',
  );
  expect(richMarkdown).toContain("<CopyableInline key={index} value={node.value}");
  expect(richMarkdown).toContain("<MarkdownLink key={index} url={node.url}>");
  expect(richMarkdown).toContain('accessibilityRole="link"');
  expect(richMarkdown).toContain("if (external) void Linking.openURL(url);");
  expect(richMarkdown).toContain("if (openLocalLink?.(url)) return;");
  expect(richMarkdown).toContain("markdownTableLayout(minimumWidth, columnCount)");
  expect(richMarkdown).toContain("const availableWidth = useRichContentWidth()");
  expect(richMarkdown).not.toContain("MARKDOWN_TABLE_MAX_HEIGHT");
  expect(richMarkdown).toContain("<MermaidDiagram");
  expect(richMarkdown).toContain("<AsciiDiagram source={node.value}");
  expect(richMarkdown).toContain("looksLikeAsciiDiagram(node.value, node.lang)");
  expect(richMarkdown).toContain("source={node.value}");
  expect(richMarkdown).toContain("reviewTarget: review.target");
  expect(mermaidNative).toContain('rendererUri: "file:///android_asset/mermaid-renderer.html"');
  expect(mermaidNative).toContain(
    'rendererUri: "file:///android_asset/ascii-diagram-renderer.html"',
  );
  expect(mermaidNative).toContain('accessibilityLabel="Open diagram fullscreen"');
  expect(mermaidNative).toContain('accessibilityLabel="Zoom in"');
  expect(mermaidNative).toContain('accessibilityLabel="Reset zoom"');
  expect(mermaidNative).toContain('accessibilityLabel="Zoom out"');
  expect(mermaidNative).not.toContain("useSafeAreaInsets");
  expect(mermaidNative).toContain('mode="inline"');
  expect(mermaidNative).toContain('mode="fullscreen"');
  expect(mermaidNative).toContain('if (message.type === "ready")');
  expect(mermaidNative).toContain("loaded.current = true;\n      render();");
  expect(mermaidNative).toContain("allowFileAccessFromFileURLs");
  expect(mermaidNative).toContain("allowUniversalAccessFromFileURLs={false}");
  expect(mermaidNative).toContain("onContentProcessDidTerminate={restartRenderer}");
  expect(mermaidNative).toContain("onRenderProcessGone={restartRenderer}");
  expect(richMarkdown).toContain("style={[styles.tableViewport, minimumWidth > 0");
  expect(richMarkdown).toContain(
    'codeContainer: { width: "100%", minWidth: 0, maxWidth: "100%", alignSelf: "stretch"',
  );
  expect(richMarkdown).toContain("style={styles.tableHorizontalScroller}");
  expect(richMarkdown).not.toContain("tableVerticalScroller");
  expect(richMarkdown).not.toContain("showsVerticalScrollIndicator");
  expect(richMarkdown).toContain("tableHorizontalScroller: { flexGrow: 0");
  expect(richMarkdown).toContain("tableCell: { flexShrink: 0");
  expect(richMarkdown).not.toContain("borderLeftWidth: 3");
  expect(richMarkdown).toContain("document: { minWidth: 0, gap: spacing.xxs }");
  expect(richMarkdown).not.toContain('document: { minWidth: 0, maxWidth: "100%"');
  expect(richMarkdown).toContain("<View style={styles.document}>");
  expect(richMarkdown).not.toContain("documentFill:");
  expect(documentPreviewHost).toContain(
    'document: { width: "100%", minWidth: 0, alignSelf: "center"',
  );
  expect(documentPreviewHost).toContain("maxWidth: documentReadingWidth(textScale)");
  expect(screen).not.toContain(
    'historyViewport.phase === "loading" || !timelinePositioned ? "updating" : null',
  );
  expect(screen).not.toContain(
    'status: cachedSnapshotAvailable ? "background-updating" : "initial-loading"',
  );
  expect(screen).not.toContain('"loading history…"');
  expect(screen).not.toContain('conversationActivity === "updating"');
  expect(screen).not.toContain('? "updating…"');
  expect(screen).not.toContain("stripLeadingEmoji(thread.title)");
  expect(screen).not.toContain('thread.title.replace(/^[^\\p{L}\\p{N}]+\\s*/u, "")');
  expect(screen).not.toContain("TLS pinned</Text>");
  expect(screen).not.toContain("const selectedThreadSummaryQuery = useLiveQuery(");
  expect(screen).not.toContain("storedThreadToDemo");
  expect(screen).not.toContain("useThreadChatWindowContent");
  expect(screen).not.toContain("windowCoverage.complete ? remoteThread : null");
  expect(screen).not.toContain("const windowCoverage = chatDatabase.windowCoverage");
  expect(screen).not.toContain("remoteThreadCacheRef");
  expect(screen).not.toContain("removeClippedSubviews={false}");
  expect(timelineList).toContain("KeyboardAwareLegendList");
  expect(screen).not.toContain("ConversationPanelBlur");
  expect(screen).not.toContain('direction="down"');
  expect(screen).not.toContain('direction="up"');
  expect(screen).not.toContain("useKeyboardChatComposerInset");
  expect(screen).not.toContain("useKeyboardScrollToEnd");
  expect(screen).not.toContain("keyboardTrackingStore");
  expect(screen).not.toContain("enabled={keyboardTrackingEnabled}");
  expect(screen).not.toContain("maintainScrollAtEndEnabled=");
  expect(screen).not.toContain("followLiveTail=");
  expect(screen).not.toContain("contentInsetEndAdjustment={contentInsetEndAdjustment}");
  expect(screen).not.toContain("freeze={timelineKeyboardFreeze}");
  expect(screen).not.toContain("timelineTailFollowEnabled");
  expect(screen).not.toContain("updateFollowingLatest");
  expect(screen).not.toContain("ListFooterComponent={TimelineBottomSpacer}");
  expect(screen).not.toContain('testID="timeline-bottom-spacer"');
  expect(screen).not.toContain('testID="last-user-footer-reserve"');
  expect(screen).not.toContain("Message was not accepted. Edit it and retry.");
  expect(screen).not.toContain(
    "if (scrollRestoredRef.current && followingLatestRef.current) markTimelineAtLatest()",
  );
  expect(screen).not.toContain("THREAD_SWIPE_UNDERLAY_OVERLAP + translation.get()");
  expect(screen).not.toContain('<MaterialIcons name="push-pin" size={19} color="#ffffff" />');
  expect(screen).not.toContain('<Ionicons name={icon} size={19} color="#ffffff" />');
  expect(screen).not.toContain('testID="unread-bubble-dot"');
  expect(screen).not.toContain("unread={item.id === unreadFinalTurnId}");
  expect(screen).not.toContain('active={rawTurn.status === "inProgress"}');
  expect(screen).not.toContain("useEffect(() => markActiveThreadRead(), [markActiveThreadRead])");
  expect(screen).not.toContain("styles.unreadBadge");
  expect(screen).not.toContain("offset={{ opened: conversationInsets.bottom }}");
  expect(screen).not.toContain("followingLatestRef");
  expect(screen).not.toContain("DECLARATIVE_TIMELINE_END");
  expect(screen).not.toContain("scheduleTimelineEndPin");
  expect(screen).not.toContain("timelineEndPinFrameRef");
  expect(timelineList).not.toContain("pinToEnd");
  expect(screen).not.toMatch(
    /onScrollBeginDrag=\{\(\{ nativeEvent \}\) => \{[\s\S]{0,500}historyViewport\.freeze\(\)/u,
  );
  expect(screen).not.toContain("freezeSettledHistoryRange");
  expect(screen).not.toContain("onScrollToIndexFailed={({ index, averageItemLength }) => {");
  expect(screen).not.toContain("maxToRenderPerBatch={10}");
  expect(screen).not.toContain("updateCellsBatchingPeriod={32}");
  expect(screen).not.toContain("windowSize={11}");
  expect(screen).not.toContain("markTimelineAtLatest");
  expect(screen).not.toContain(
    "timelineRef.current?.scrollToEnd({ animated: true });\n            markTimelineAtLatest();",
  );
  expect(screen).not.toContain("sessionConversationScrollOffsets");
  expect(screen).not.toContain("scrollRestoredRef");
  expect(screen).not.toContain("INITIAL_TIMELINE_SETTLE_MS");
  expect(screen).not.toContain("<ConversationPane\n        key={navigationKey}");
  expect(screen).not.toContain("timelineInteractionStartedRef");
  expect(screen).not.toContain("scheduleInitialTimelinePosition");
  expect(screen).not.toContain("olderLoadTriggeredForDragRef");
  expect(screen).not.toContain("viewabilityConfig={timelineViewabilityConfig}");
  expect(screen).not.toContain("OLDER_PAGE_TRIGGER_PX");
  expect(screen).not.toContain("requestResidentRangeMove");
  expect(timelineList).toContain("initialScrollAtEnd");
  expect(timelineList).toContain("alignItemsAtEnd");
  expect(timelineList).toContain("estimatedItemSize={TIMELINE_ESTIMATED_ITEM_SIZE}");
  expect(screen).not.toContain('testID="timeline-positioning-loader"');
  expect(screen).not.toContain("contentHeight - timelineViewportHeightRef.current - pendingOffset");
  expect(screen).not.toContain("historyViewport.prefetch()");
  expect(screen).not.toContain("pendingRestoreOffsetRef");
  expect(screen).not.toContain("if (resolvedHeight === 0) return");
});
