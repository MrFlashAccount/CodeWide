import { expect, it } from "vitest";
import {
  screen,
  timelineList,
  bubble,
  richMarkdown,
  privateImageCache,
  imagePreviewHost,
  privateImageUri,
  documentPreviewHost,
  nativeCodeBlock,
  wirelessDev,
} from "./platform-sources";

it("preserves platform integration contracts — 2", () => {
  expect(screen).not.toContain("composerTracksKeyboard");
  expect(screen).not.toContain("shouldOpenOnLongPress");
  expect(screen).not.toContain("userCopyButton");
  expect(screen).not.toContain("function AgentBubbleHeader({ copyText");
  expect(screen).not.toContain("stableTextKey(body)");
  expect(screen).not.toContain("composerInputHeight");
  expect(timelineList).toContain("<KeyboardAwareTimelineList");
  expect(screen).not.toContain("estimatedItemSize={64}");
  expect(screen).not.toContain("extraData={windowLayout.measurementRevision}");
  expect(screen).not.toContain("<FlatList");
  expect(timelineList).toContain("<KeyboardAwareTimelineList");
  expect(timelineList).toContain("keyboardLiftBehavior={keyboardLiftBehavior}");
  expect(timelineList).toContain("keyboardOffset={keyboardOffset}");
  expect(timelineList).not.toContain("FlashList");
  expect(timelineList).toContain("maintainVisibleContentPosition={{ data: true, size: true }}");
  expect(timelineList).toContain("dataKey={renderRevision}");
  expect(screen).not.toContain("<ConversationPane\n        key={navigationKey}");
  expect(screen).not.toContain("const transitionConversationScope = useEffectEvent(() => {");
  expect(screen).not.toContain("pendingRestoreOffsetRef");
  expect(screen).not.toContain("transitionConversationScope();");
  expect(timelineList).toContain("recycleItems={false}");
  expect(timelineList).toContain("drawDistance={250}");
  expect(screen).not.toContain("ExpansionRegistryContext");
  expect(screen).not.toContain("previous.turn === next.turn");
  expect(screen).not.toMatch(/\buseM[e]mo\(/u);
  expect(screen).not.toMatch(/\bm[e]mo\(function/u);
  expect(screen).not.toMatch(/React\.m[e]mo\(/u);
  expect(timelineList).not.toContain("previous.data === next.data");
  expect(timelineList).toContain("itemsAreEqual={itemsAreEqual ?? referenceEqual}");
  expect(timelineList).toContain("function referenceEqual<ItemT>");
  expect(screen).not.toContain(
    "renderRevision={`${composerScope}:${windowLayout.measurementRevision}`}",
  );
  expect(screen).not.toContain('codexBubble: { overflow: "hidden"');
  expect(screen).not.toContain("const richContentWidth = timelineItemWidth > 0");
  expect(screen).not.toContain("<RichContentWidthProvider width={richContentWidth}>");
  expect(bubble).toContain("export function BubbleContent({ children }: { children: ReactNode })");
  expect(bubble).not.toContain("measurePretextBubble");
  expect(bubble).not.toContain("measurementSource");
  expect(bubble).toContain("flexGrow: 1");
  expect(bubble).toContain("flexBasis: 0");
  expect(bubble).not.toMatch(/\bheight\s*:/u);
  expect(bubble).toContain("agentSurface: {");
  expect(bubble).toContain('maxWidth: "100%"');
  expect(screen).not.toContain("agentBubbleWidthPolicy");
  expect(screen).not.toContain("codexBubbleWide:");
  expect(screen).not.toContain(
    'rawTurn.status === "inProgress"\n    || latestAgentBlock?.content?.fields["/text"]',
  );
  expect(screen).not.toContain('userMessageContent: { minWidth: 0, maxWidth: "100%"');
  // WHY: ledger row composerAttachments has no static or dynamic consumer; closure deletes it.
  expect(screen).not.toContain("composerAttachments:");
  expect(screen).not.toContain("composerAttachments: { flexGrow: 0, backgroundColor:");
  expect(screen).not.toContain("composerAttachments: { flexGrow: 0, borderTopWidth");
  expect(screen).not.toContain("activeThreadResourcesTaskKey");
  expect(screen).not.toContain("styles.agentReplyMeta");
  expect(screen).not.toContain("autoExpandWhileRunning");
  expect(richMarkdown).toContain('list: { minWidth: 0, alignSelf: "flex-start"');
  expect(richMarkdown).toContain('listRow: { minWidth: 0, alignSelf: "flex-start"');
  expect(richMarkdown).toContain("listBody: { minWidth: 0, flexShrink: 1, gap: spacing.optical }");
  expect(richMarkdown).not.toContain(
    "listBody: { minWidth: 0, flexGrow: 1, flexShrink: 1, flexBasis: 0",
  );
  expect(privateImageCache).toContain("cacheInlineAttachment");
  expect(imagePreviewHost).toContain("const [decodeState, setDecodeState]");
  expect(imagePreviewHost).toContain("Image decode failed");
  expect(screen).not.toContain("asyncResourceFunctionKey(getTransferAccess)");
  expect(privateImageUri).toContain(
    "`private-asset:${accessScope}:${revision}:${privateImageResourceKey(source)}`",
  );
  expect(documentPreviewHost).toContain("readPrivateAssetText(");
  expect(screen).not.toContain("url.pathname = `/v1/content/${reference.id}`");
  expect(nativeCodeBlock).toContain("fillAvailableWidth && availableWidth !== null");
  expect(privateImageUri).not.toContain("asyncResourceFunctionKey");
  expect(imagePreviewHost).toContain("const [controller] = useState<PreviewController>");
  expect(screen).not.toContain("turnItemsInFlightRef");
  expect(screen).not.toContain("lifecycleRepairAttemptRef");
  expect(screen).not.toContain("activeThreadHydrationScope !== hydratedThreadScope");
  expect(screen).not.toContain("threadHydrationRef");
  expect(screen).not.toContain("historyResourceRaw?.residentTurnLimit");
  expect(screen).not.toContain("historyResourceRaw.residentMaxOrdinal");
  expect(screen).not.toContain("threadInitialWindow");
  expect(screen).not.toContain("activeResidentOffset");
  expect(screen).not.toContain("remote.getCachedThread(activeConnectionId, activeRemoteThreadId)");
  expect(screen).not.toContain("await remote.readThread(");
  expect(screen).not.toContain("applyThreadEventsImmutable(window.thread, bufferedPayloads)");
  expect(screen).not.toContain("requiresJournalCatchUp");
  expect(screen).not.toContain('recordTiming("thread_cached_visible_ms"');
  expect(screen).not.toContain('recordTiming("thread_fresh_visible_ms"');
  expect(screen).not.toContain("const hydrationTaskKey");
  expect(screen).not.toContain("byThread.delete(hydration.key)");
  expect(screen).not.toContain("mergeVisibleThread(");
  expect(wirelessDev).toContain("EXPO_PACKAGER_PROXY_URL");
  expect(wirelessDev).toContain("CODEWIDE_METRO_URL");
  expect(wirelessDev).not.toContain("adb reverse");
  expect(wirelessDev).not.toContain("no authorized Android device attached");
  expect(wirelessDev).toContain('"$@"');
});
