import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { compactSource, sourceObjectDeclaration } from "./source-contract";

const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
const screen = compactSource(
  readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8"),
);
const threadListFeature = compactSource(
  readFileSync(
    new URL("../src/features/threadList/ThreadListFeature.tsx", import.meta.url),
    "utf8",
  ),
);
const nativeFullscreenModal = readFileSync(
  new URL("../src/ui/AppFullscreenModal.native.tsx", import.meta.url),
  "utf8",
);
const androidFullscreenModal = readFileSync(
  new URL("../src/ui/AppFullscreenModal.android.tsx", import.meta.url),
  "utf8",
);
const webFullscreenModal = readFileSync(
  new URL("../src/ui/AppFullscreenModal.tsx", import.meta.url),
  "utf8",
);
const fullscreenOverlay = readFileSync(
  new URL("../src/ui/AppFullscreenOverlay.tsx", import.meta.url),
  "utf8",
);
const heroUIRoot = readFileSync(
  new URL("../src/ui/HeroUIRoot.native.tsx", import.meta.url),
  "utf8",
);
const codeReviewWorkspace = readFileSync(
  new URL("../src/features/review/CodeReviewWorkspace.tsx", import.meta.url),
  "utf8",
);
const imagePreviewHost = readFileSync(
  new URL("../src/rendering/ImagePreviewHost.tsx", import.meta.url),
  "utf8",
);
const mermaid = readFileSync(
  new URL("../src/rendering/MermaidDiagram.native.tsx", import.meta.url),
  "utf8",
);
const subagentSheet = readFileSync(
  new URL("../src/features/agents/SubagentSheet.tsx", import.meta.url),
  "utf8",
);
const subagentWorkspace = readFileSync(
  new URL("../src/features/agents/SubagentWorkspace.tsx", import.meta.url),
  "utf8",
);

function productSources(directory: string): Array<{ path: string; source: string }> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && directory === sourceRoot && entry.name === "v2") return [];
    if (entry.isDirectory()) return productSources(path);
    return [".ts", ".tsx"].includes(extname(entry.name))
      ? [{ path, source: readFileSync(path, "utf8") }]
      : [];
  });
}

const ownerComposerPortContextChip = compactSource(
  readFileSync(
    new URL("../src/features/ports/ComposerPortContextChip.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerPortsFeature = compactSource(
  readFileSync(new URL("../src/features/ports/PortsFeature.tsx", import.meta.url), "utf8"),
);

const ownerComposerSubagentContextChip = compactSource(
  readFileSync(
    new URL("../src/features/agents/ComposerSubagentContextChip.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerAgentsFeature = compactSource(
  readFileSync(new URL("../src/features/agents/AgentsFeature.tsx", import.meta.url), "utf8"),
);

const ownerOverlayScrollOwnership = compactSource(
  readFileSync(
    new URL("../src/features/conversation/timeline/overlayScrollOwnership.ts", import.meta.url),
    "utf8",
  ),
);
const ownerTimelineViewport = compactSource(
  readFileSync(
    new URL("../src/features/conversation/timeline/TimelineViewport.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerComposerLayout = compactSource(
  readFileSync(new URL("../src/features/composer/composerLayout.ts", import.meta.url), "utf8"),
);
const ownerComposerFeatureStyles = compactSource(
  readFileSync(
    new URL("../src/features/composer/ComposerFeature.styles.ts", import.meta.url),
    "utf8",
  ),
);
const ownerComposerMenuComposition = compactSource(
  readFileSync(
    new URL("../src/features/workspace/ComposerMenuComposition.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerComposerMenu = compactSource(
  readFileSync(new URL("../src/features/composer/ComposerMenu.tsx", import.meta.url), "utf8"),
);
const ownerThreadTimeline = compactSource(
  readFileSync(
    new URL("../src/features/conversation/timeline/ThreadTimeline.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerTurnActivity = compactSource(
  readFileSync(
    new URL("../src/features/conversation/turns/TurnActivity.tsx", import.meta.url),
    "utf8",
  ),
);

const toolsOwner = compactSource(
  readFileSync(
    new URL("../src/features/conversation/ConversationTools.tsx", import.meta.url),
    "utf8",
  ),
);

const contextStrip = compactSource(
  readFileSync(
    new URL("../src/features/composer/ComposerContextStrip.tsx", import.meta.url),
    "utf8",
  ),
);

const contextStyles = compactSource(
  readFileSync(
    new URL("../src/features/composer/ComposerContextStrip.styles.ts", import.meta.url),
    "utf8",
  ),
);

const subagentRenderer = compactSource(
  readFileSync(
    new URL("../src/features/conversation/SubagentConversation.tsx", import.meta.url),
    "utf8",
  ),
);

const workspaceOwner = compactSource(
  readFileSync(
    new URL("../src/features/conversation/ConversationWorkspace.tsx", import.meta.url),
    "utf8",
  ),
);

const activityOwner = compactSource(
  readFileSync(
    new URL(
      "../src/features/conversation/protocol/AgentActivityProtocolBlock.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
);

const viewportActions = compactSource(
  readFileSync(
    new URL("../src/features/conversation/timeline/timelineViewport.ts", import.meta.url),
    "utf8",
  ),
);

const turnOwner = compactSource(
  readFileSync(
    new URL("../src/features/conversation/turns/TurnTimelineItem.tsx", import.meta.url),
    "utf8",
  ),
);

const ownerWorkspaceThreadList = compactSource(
  readFileSync(
    new URL("../src/features/workspace/WorkspaceThreadList.tsx", import.meta.url),
    "utf8",
  ),
);

const destinationView = compactSource(
  readFileSync(
    new URL("../src/features/conversation/ConversationDestinationSurface.tsx", import.meta.url),
    "utf8",
  ),
);

describe("fullscreen workspace presentation", () => {
  it("owns system safe areas in the single shared fullscreen shell", () => {
    for (const source of [nativeFullscreenModal, androidFullscreenModal, webFullscreenModal]) {
      expect(source).toContain('testID="fullscreen-modal-safe-area"');
      expect(source).toContain("edges={FULLSCREEN_SAFE_AREA_EDGES}");
      expect(source).toContain(
        'const FULLSCREEN_SAFE_AREA_EDGES: readonly Edge[] = ["top", "right", "bottom", "left"]',
      );
    }
    expect(codeReviewWorkspace).not.toContain("useSafeAreaInsets");
    expect(fullscreenOverlay).toContain(
      'import { AppFullscreenModal } from "./AppFullscreenModal";',
    );
    expect(subagentSheet).not.toContain("AppFullscreenModal");
    expect(screen).not.toContain("AppFullscreenModal");
  });

  it("hosts unchanged React workspaces inside a full-size dark Compose dialog", () => {
    expect(androidFullscreenModal).toContain("<BasicAlertDialog");
    expect(androidFullscreenModal).toContain('<Host colorScheme="dark"');
    expect(androidFullscreenModal).toContain("usePlatformDefaultWidth: false");
    expect(androidFullscreenModal).toContain("decorFitsSystemWindows: false");
    expect(androidFullscreenModal).toContain("<RNHostView matchContents={false}>");
    expect(androidFullscreenModal).toContain("<SafeAreaProvider");
    expect(androidFullscreenModal).toContain("<FullscreenWindowReadyProvider ready={windowReady}>");
    expect(androidFullscreenModal).toContain("setNativeVoiceAuraTarget(reactTag)");
    expect(androidFullscreenModal).toContain("props.onShow?.()");
    expect(androidFullscreenModal).not.toContain("<Modal");
    expect(ownerOverlayScrollOwnership).toContain("fullscreenScrollOwnership.willOpen(id)");
    expect(ownerTimelineViewport).toContain("scrollsChildToFocus={false}");
  });

  it("keeps keyboard geometry live while fullscreen coverage suspends timeline actions", () => {
    // Wiring contract: native keyboard handlers cannot run in Node. Freezing them
    // drops the IME close event and leaves its inset behind after the overlay closes.
    const timelineList = readFileSync(
      new URL("../src/rendering/ThreadTimelineList.tsx", import.meta.url),
      "utf8",
    );
    expect(ownerTimelineViewport).toContain('keyboardLiftBehavior="always"');
    expect(screen).not.toContain("keyboardScrollFrozen");
    expect(timelineList).not.toContain("freeze:");
    expect(timelineList).not.toContain("freeze=");
    expect(viewportActions).toContain("if (fullscreenScrollOwnership.isCovered()) return;");
    expect(ownerTimelineViewport).toContain("followTail={ !props.fullscreenCovered &&");
    expect(ownerOverlayScrollOwnership).toContain("didClose: fullscreenScrollOwnership.didClose");
  });

  it("hardware-accelerates the Android fullscreen window used by WebView renderers", () => {
    expect(nativeFullscreenModal).toContain("hardwareAccelerated");
    expect(nativeFullscreenModal).toContain("setWindowReady(true)");
    expect(mermaid).toContain('androidLayerType="hardware"');
    expect(compactSource(mermaid)).toContain('enabled={fullscreenReady} mode="fullscreen"');
  });

  it("captures lifecycle before mounting and owns close/show centrally", () => {
    expect(fullscreenOverlay.indexOf("binding.lifecycle?.willOpen?.(id);")).toBeLessThan(
      fullscreenOverlay.indexOf("publish([...entriesRef.current, entry]);"),
    );
    expect(fullscreenOverlay).toContain("onShow={() => {");
    expect(fullscreenOverlay).toContain("entry.lifecycle?.didClose?.(entry.id)");
    expect(fullscreenOverlay).toContain("const active = entries.at(-1) ?? null;");
    expect(fullscreenOverlay).toContain("if (active === null) return null;");
    expect(nativeFullscreenModal).toContain("if (!isOpen) return null;");
    expect(fullscreenOverlay).toContain(
      "useLayoutEffect(() => () => host.dismissUnmountedScope(scope), [host, scope])",
    );
  });

  it("keeps parent fullscreen workspaces mounted when a child is presented", () => {
    expect(fullscreenOverlay).toContain("entries.map((entry) => {");
    expect(fullscreenOverlay).toContain("const isActive = entry.id === active.id;");
    expect(fullscreenOverlay).toContain("key={entry.id}");
    expect(fullscreenOverlay).toContain("!isActive && styles.hiddenLayer");
    expect(fullscreenOverlay).toContain('hiddenLayer: { display: "none" }');
    expect(fullscreenOverlay).not.toContain("{active.content}");
  });

  it("mounts exactly one fullscreen overlay host for the application", () => {
    expect(heroUIRoot.match(/<AppFullscreenOverlayProvider>/gu)).toHaveLength(1);
    expect(heroUIRoot.match(/<AppFullscreenOverlayHost \/>/gu)).toHaveLength(1);
    expect(screen).not.toContain("AppFullscreenOverlayProvider");
  });

  it("keeps every fullscreen workspace inside the global document preview services", () => {
    const imageHost = heroUIRoot.indexOf("<ImagePreviewHost>");
    const documentHost = heroUIRoot.indexOf("<DocumentPreviewHost>");
    const overlayHost = heroUIRoot.indexOf("<AppFullscreenOverlayHost />");
    expect(imageHost).toBeGreaterThanOrEqual(0);
    expect(documentHost).toBeGreaterThan(imageHost);
    expect(overlayHost).toBeGreaterThan(documentHost);
    expect(screen).not.toContain("<ImagePreviewHost>");
    expect(screen).not.toContain("<DocumentPreviewHost>");
  });

  it("routes every product fullscreen through the overlay host", () => {
    const directNativeModalOwners = productSources(sourceRoot)
      .filter(
        ({ path, source }) =>
          /<Modal\b/u.test(source) &&
          !path.endsWith("AppFullscreenModal.tsx") &&
          !path.endsWith("AppFullscreenModal.native.tsx"),
      )
      .map(({ path }) => path.slice(sourceRoot.length + 1));
    const directFullscreenShellConsumers = productSources(sourceRoot)
      .filter(
        ({ path, source }) =>
          source.includes("AppFullscreenModal") &&
          !path.endsWith("AppFullscreenModal.tsx") &&
          !path.endsWith("AppFullscreenModal.native.tsx") &&
          !path.endsWith("AppFullscreenModal.android.tsx") &&
          !path.endsWith("AppFullscreenOverlay.tsx"),
      )
      .map(({ path }) => path.slice(sourceRoot.length + 1));

    expect(directNativeModalOwners).toEqual([]);
    expect(directFullscreenShellConsumers).toEqual([]);
    expect(imagePreviewHost).toContain("fullscreen.present(({ close }) => (");
    expect(imagePreviewHost).not.toContain("<Modal");
    expect(mermaid).toContain("fullscreenOverlay.present(({ close }) => (");
    expect(mermaid).not.toContain("<Modal");
  });

  it("places Subagents after Attachments in the composer context strip", () => {
    const start = contextStrip.indexOf('<ScrollView testID="composer-context-strip"');
    const end = contextStrip.indexOf("</ScrollView>", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const strip = toolsOwner;
    expect(strip.indexOf("<ThreadResourceContextChips")).toBeGreaterThanOrEqual(0);
    expect(strip.indexOf("<ComposerSubagentContextChip")).toBeGreaterThan(
      strip.indexOf("<ThreadResourceContextChips"),
    );
    expect(ownerComposerSubagentContextChip).toContain("Subagents: ${visible.length}");
    const contextContent = sourceObjectDeclaration(contextStyles, "composerContextContent");
    expect(contextContent).toContain('alignItems: "center"');
    expect(contextContent).toContain("paddingHorizontal: conversationChromeEdgeInset");
    expect(contextContent).toContain("paddingTop: COMPOSER_CHIP_TOP_INSET");
    expect(contextContent).toContain("paddingBottom: 0");
    expect(ownerComposerLayout).toContain("const COMPOSER_CHIP_TOP_INSET = spacing.xxs;");
    expect(ownerComposerLayout).toContain("const COMPOSER_CHIP_BOTTOM_INSET = spacing.xxs;");
    expect(ownerComposerFeatureStyles).toContain(
      "minHeight: touchTarget + COMPOSER_CHIP_BOTTOM_INSET + spacing.compact",
    );
    expect(ownerComposerFeatureStyles).toContain(
      "paddingTop: COMPOSER_CHIP_BOTTOM_INSET, paddingBottom: spacing.compact",
    );
  });

  it("exposes live port forwarding as a direct composer chip", () => {
    const start = contextStrip.indexOf('<ScrollView testID="composer-context-strip"');
    const end = contextStrip.indexOf("</ScrollView>", start);
    const strip = toolsOwner;
    expect(strip).toContain(
      '<ComposerPortContextChip connectionId={props.portForwardingConnectionId} onOpen={() => props.composerCommands.composerControlActionsBinding.openControls("ports")} />',
    );
    expect(ownerComposerPortContextChip).toContain('testID="composer-ports-label"');
    expect(ownerComposerPortContextChip).toContain("snapshot.profiles.length === 0");
    expect(ownerComposerPortContextChip).toContain(
      'snapshot.profiles.some(({ status }) => status === "live") ? colors.green : colors.textMuted',
    );
    expect(ownerComposerMenuComposition).toContain('page === "ports" ? (');
    expect(ownerPortsFeature).toContain(
      "<PortForwardingManager {...portForwarding} renderScrollComponent={AppSheetScrollView} />",
    );
    expect(ownerComposerMenu).toContain('if (page === "ports") return "Ports";');
  });

  it("does not expose the non-descriptive no-prompts approval label", () => {
    expect(screen).not.toContain('"No prompts"');
  });

  it("uses back navigation for the subagent list and reads its chat through the shared model", () => {
    const headerStart = subagentWorkspace.indexOf("<View style={styles.masterHeader}>");
    const headerEnd = subagentWorkspace.indexOf(
      "</View>",
      subagentWorkspace.indexOf("</View>", headerStart) + 1,
    );
    const header = subagentWorkspace.slice(headerStart, headerEnd);
    expect(header).toContain('accessibilityLabel="Back to conversation"');
    expect(header).toContain('name="arrow-back"');
    expect(header).not.toContain('name="close"');
    expect(subagentSheet).toContain("subagentsForThread(summaries, parentThreadId)");
    expect(subagentSheet).not.toContain("useLiveQuery");
    expect(subagentSheet).toContain("useThreadChatWindow(threadDetails");
    expect(subagentSheet).not.toContain("useAsyncResource");
    expect(screen).not.toContain("readSubagentThread");
    expect(ownerAgentsFeature).toContain("void onRefreshSubagents?.(draftThreadId).catch");

    expect(subagentRenderer).toContain("<ConversationReadSurface");
    expect(subagentRenderer).toContain("<ReadOnlyComposerContext");
    expect(subagentRenderer).toContain("onOpenSubagentThread={onOpenSubagent}");
    expect(subagentRenderer).not.toContain("<SubagentTranscript");
    expect(ownerAgentsFeature).toContain("{ dismissOnScopeUnmount: false }");
    expect(screen).not.toContain('testID="subagent-task-card"');
    expect(subagentSheet).not.toContain("onLoadResources");
    expect(subagentSheet).toContain("initialThreadId");
    expect(subagentSheet).toContain("onOpenSubagent={openById}");
    expect(subagentSheet).toContain("startSubagentTransition(() => setSelectedId(threadId))");
    expect(subagentSheet).toContain("<Suspense\n              fallback={");
    expect(subagentSheet.indexOf("function SubagentConversationDetail")).toBeGreaterThan(
      subagentSheet.indexOf("<Suspense fallback={"),
    );
    expect(fullscreenOverlay).toContain(
      "<Suspense fallback={<FullscreenOverlaySuspenseFallback />}>",
    );
  });

  it("keeps the model-owned cached subagent text visible and updates recycled selection", () => {
    expect(subagentSheet).toContain("applyThreadSummaryMetadata(materializedThread, summary)");
    expect(subagentSheet).toContain("did not materialize from its ready window");
    expect(subagentSheet).toContain("if (conversation === null)");
    expect(subagentSheet).toContain("useState<string | null>(initialThreadId)");
    expect(subagentSheet).not.toContain("remoteThreadResource");
    expect(subagentWorkspace).toContain("extraData={selected?.remoteThreadId ?? null}");
  });

  it("contains suspension and render failures at each independently recoverable surface", () => {
    // Both layout branches are enclosed by the same scoped recovery owner.
    expect(threadListFeature).toMatch(
      /<RecoverableRenderBoundary[^>]*label="Chat list"[\s\S]*<Suspense fallback=\{<ThreadListSuspenseFallback \/>\}>[\s\S]*view\.mode === "desktop" \? \(?\s*<ThreadSidebar[^>]*\/>\s*\)? : \(?\s*<MobileThreads[^>]*\/>[\s\S]*<\/Suspense>[\s\S]*<\/RecoverableRenderBoundary>/u,
    );
    expect(threadListFeature).toContain("resetKey={`${view.mode}-chat-list:${scopeKey}`}");
    expect(ownerWorkspaceThreadList).toContain("<ThreadListFeature scopeKey={sidebarScopeKey}");
    expect(ownerWorkspaceThreadList).toMatch(/view=\{\s*desktop \? \{ mode: "desktop", props:/u);
    expect(ownerWorkspaceThreadList).toContain(': { mode: "mobile", props:');
    const conversation = destinationView;
    expect(conversation).toContain('label="Conversation"');
    expect(conversation).toContain("fallback={ <ConversationNavigationFallback");
    expect(conversation).toContain("compact={!props.desktop}");
    expect(conversation).toContain("onDismiss={props.scope.closeActiveConversation}");
    expect(turnOwner).toContain('scope="bubble"');
    expect(ownerThreadTimeline).toContain('label="Conversation item"');
    expect(subagentSheet).toContain('label="Subagent conversation"');
    expect(subagentSheet).toContain("<SubagentConversationDetail");
    expect(fullscreenOverlay).toContain("fullscreen-overlay-suspense-fallback");
    expect(fullscreenOverlay).toContain('label="Fullscreen overlay content"');
    expect(fullscreenOverlay).toContain("onDismiss={() => close(entry.id)}");
  });

  it("opens a concrete subagent from agent activity instead of expanding an empty card", () => {
    const renderer = activityOwner;
    expect(renderer).toContain("subagentActivityTargetThreadId");
    expect(renderer).toContain('testID="subagent-activity-link"');
    expect(renderer).toContain('name="chevron-forward"');
    expect(renderer).toContain("containerStyle={styles.cardTitleWave}");
    expect(renderer).toContain("styles.cardHeaderToggle");
    expect(renderer).toContain("style={styles.cardHeader}");
    expect(renderer).toContain("style={styles.agentActivityMeta}");
    expect(renderer).toContain("{activityLabel} </Text>");
    expect(renderer).not.toContain("· Open subagent");
    expect(renderer).not.toContain("agentNavigationSubtitle");
    expect(renderer).not.toContain("<Card");
    expect(ownerTurnActivity).toContain('testID="subagent-activity-navigation"');
    expect(ownerTurnActivity).toContain("if (agentNavigationOnly)");
  });
});
