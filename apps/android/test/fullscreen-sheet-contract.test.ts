import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
const nativeFullscreenModal = readFileSync(new URL("../src/ui/AppFullscreenModal.native.tsx", import.meta.url), "utf8");
const webFullscreenModal = readFileSync(new URL("../src/ui/AppFullscreenModal.tsx", import.meta.url), "utf8");
const fullscreenOverlay = readFileSync(new URL("../src/ui/AppFullscreenOverlay.tsx", import.meta.url), "utf8");
const heroUIRoot = readFileSync(new URL("../src/ui/HeroUIRoot.native.tsx", import.meta.url), "utf8");
const codeReviewWorkspace = readFileSync(new URL("../src/rendering/CodeReviewWorkspace.tsx", import.meta.url), "utf8");
const imagePreviewHost = readFileSync(new URL("../src/rendering/ImagePreviewHost.tsx", import.meta.url), "utf8");
const mermaid = readFileSync(new URL("../src/rendering/MermaidDiagram.native.tsx", import.meta.url), "utf8");
const subagentSheet = readFileSync(new URL("../src/ui/SubagentSheet.tsx", import.meta.url), "utf8");
const subagentWorkspace = readFileSync(new URL("../src/ui/SubagentWorkspace.tsx", import.meta.url), "utf8");

function productSources(directory: string): Array<{ path: string; source: string }> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productSources(path);
    return [".ts", ".tsx"].includes(extname(entry.name))
      ? [{ path, source: readFileSync(path, "utf8") }]
      : [];
  });
}

describe("fullscreen workspace presentation", () => {
  it("owns system safe areas in the single shared fullscreen shell", () => {
    for (const source of [nativeFullscreenModal, webFullscreenModal]) {
      expect(source).toContain('testID="fullscreen-modal-safe-area"');
      expect(source).toContain("edges={FULLSCREEN_SAFE_AREA_EDGES}");
      expect(source).toContain('const FULLSCREEN_SAFE_AREA_EDGES: readonly Edge[] = ["top", "right", "bottom", "left"]');
    }
    expect(codeReviewWorkspace).not.toContain("useSafeAreaInsets");
    expect(fullscreenOverlay).toContain('import { AppFullscreenModal } from "./AppFullscreenModal";');
    expect(subagentSheet).not.toContain("AppFullscreenModal");
    expect(screen).not.toContain("AppFullscreenModal");
  });

  it("hardware-accelerates the Android fullscreen window used by WebView renderers", () => {
    expect(nativeFullscreenModal).toContain("hardwareAccelerated");
    expect(nativeFullscreenModal).toContain("setWindowReady(true)");
    expect(mermaid).toContain('androidLayerType="hardware"');
    expect(mermaid).toContain('enabled={fullscreenReady} mode="fullscreen"');
  });

  it("captures lifecycle before mounting and owns close/show centrally", () => {
    expect(fullscreenOverlay.indexOf("binding.lifecycle?.willOpen?.(id);")).toBeLessThan(fullscreenOverlay.indexOf("publish([...entriesRef.current, entry]);"));
    expect(fullscreenOverlay).toContain("onShow={() => {");
    expect(fullscreenOverlay).toContain("entry.lifecycle?.didClose?.(entry.id)");
    expect(fullscreenOverlay).toContain("const active = entries.at(-1) ?? null;");
    expect(fullscreenOverlay).toContain("if (active === null) return null;");
    expect(nativeFullscreenModal).toContain("if (!isOpen) return null;");
    expect(fullscreenOverlay).toContain("useLayoutEffect(() => () => host.dismissUnmountedScope(scope), [host, scope])");
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
      .filter(({ path, source }) => /<Modal\b/u.test(source) && !path.endsWith("AppFullscreenModal.tsx") && !path.endsWith("AppFullscreenModal.native.tsx"))
      .map(({ path }) => path.slice(sourceRoot.length + 1));
    const directFullscreenShellConsumers = productSources(sourceRoot)
      .filter(({ path, source }) => source.includes("AppFullscreenModal") && !path.endsWith("AppFullscreenModal.tsx") && !path.endsWith("AppFullscreenModal.native.tsx") && !path.endsWith("AppFullscreenOverlay.tsx"))
      .map(({ path }) => path.slice(sourceRoot.length + 1));

    expect(directNativeModalOwners).toEqual([]);
    expect(directFullscreenShellConsumers).toEqual([]);
    expect(imagePreviewHost).toContain("fullscreen.present(({ close }) => (");
    expect(imagePreviewHost).not.toContain("<Modal");
    expect(mermaid).toContain("fullscreenOverlay.present(({ close }) => (");
    expect(mermaid).not.toContain("<Modal");
  });

  it("places Subagents after Attachments in the composer context strip", () => {
    const start = screen.indexOf('<ScrollView testID="composer-context-strip"');
    const end = screen.indexOf("</ScrollView>", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const strip = screen.slice(start, end);
    expect(strip.indexOf("<ThreadResourceContextChips")).toBeGreaterThanOrEqual(0);
    expect(strip.indexOf("<ComposerSubagentContextChip")).toBeGreaterThan(strip.indexOf("<ThreadResourceContextChips"));
    expect(screen).toContain("Subagents: ${visible.length}");
    expect(screen).toContain('composerContextContent: { alignItems: "center", gap: 6, paddingHorizontal: spacing.sm, paddingTop: 2, paddingBottom: spacing.xxs }');
  });

  it("exposes live port forwarding as a direct composer chip", () => {
    const start = screen.indexOf('<ScrollView testID="composer-context-strip"');
    const end = screen.indexOf("</ScrollView>", start);
    const strip = screen.slice(start, end);
    expect(strip).toContain('<ComposerPortContextChip connectionId={portForwardingConnectionId} onOpen={() => openControls("ports")} />');
    expect(screen).toContain('testID="composer-ports-label"');
    expect(screen).toContain("snapshot.profiles.length === 0");
    expect(screen).toContain('snapshot.profiles.some(({ status }) => status === "live") ? colors.green : colors.textMuted');
    expect(screen).toContain('page === "ports" ? (');
    expect(screen).toContain('<PortForwardingManager {...portForwarding} />');
    expect(screen).toContain('if (page === "ports") return "Ports";');
  });

  it("does not expose the non-descriptive no-prompts approval label", () => {
    expect(screen).not.toContain('"No prompts"');
  });

  it("uses back navigation for the subagent list and keeps its data live", () => {
    const headerStart = subagentWorkspace.indexOf('<View style={styles.masterHeader}>');
    const headerEnd = subagentWorkspace.indexOf("</View>", subagentWorkspace.indexOf("</View>", headerStart) + 1);
    const header = subagentWorkspace.slice(headerStart, headerEnd);
    expect(header).toContain('accessibilityLabel="Back to conversation"');
    expect(header).toContain('name="arrow-back"');
    expect(header).not.toContain('name="close"');
    expect(subagentSheet).toContain("subagentsForThread(summaries, parentThreadId)");
    expect(subagentSheet).not.toContain("useLiveQuery");
    expect(subagentSheet).toContain("useAsyncResource<ThreadWindow | null>");
    expect(screen).toContain("void onRefreshSubagents?.(draftThreadId).catch");
    const subagentRendererStart = screen.indexOf("renderThread={({ summary, thread: subagentThread");
    const subagentRendererEnd = screen.indexOf("onClose={close}", subagentRendererStart);
    const subagentRenderer = screen.slice(subagentRendererStart, subagentRendererEnd);
    expect(subagentRenderer).toContain("<ConversationPane");
    expect(subagentRenderer).toContain("readOnly");
    expect(subagentRenderer).toContain("onOpenSubagentThread={onOpenSubagent}");
    expect(subagentRenderer).not.toContain("<SubagentTranscript");
    expect(screen.slice(subagentRendererStart, screen.indexOf("const presentTerminal", subagentRendererStart))).toContain("{ dismissOnScopeUnmount: false }");
    expect(screen).not.toContain('testID="subagent-task-card"');
    expect(subagentSheet).not.toContain("onLoadResources");
    expect(subagentSheet).toContain("initialThreadId");
    expect(subagentSheet).toContain("onOpenSubagent={openById}");
    expect(subagentSheet).toContain("startSubagentTransition(() => setSelectedId(threadId))");
    expect(subagentSheet).toContain('<Suspense fallback={(');
    expect(subagentSheet.indexOf("function SubagentConversationDetail")).toBeGreaterThan(subagentSheet.indexOf("<Suspense fallback={("));
    expect(fullscreenOverlay).toContain("<Suspense fallback={<FullscreenOverlaySuspenseFallback />}>");
  });

  it("keeps cached subagent text visible after refresh failures and updates recycled selection", () => {
    expect(subagentSheet).toContain("materializedThread ?? remoteThreadResource.value?.thread ?? null");
    expect(subagentSheet).toContain("if (conversation === null)");
    expect(subagentSheet).toContain("useState<string | null>(initialThreadId)");
    expect(subagentSheet).toContain('error={remoteThreadResource.status === "error" ? remoteThreadResource.error : null}');
    expect(subagentWorkspace).toContain("extraData={selected?.remoteThreadId ?? null}");
  });

  it("contains suspension and render failures at each independently recoverable surface", () => {
    expect(screen.match(/label="Chat list"/gu)).toHaveLength(2);
    expect(screen.split("fallback={<ThreadListSuspenseFallback />}")).toHaveLength(3);
    expect(screen.match(/label="Conversation"/gu)).toHaveLength(2);
    expect(screen.split("fallback={<ConversationNavigationLoader")).toHaveLength(3);
    expect(screen).toContain('scope="bubble" label="Conversation item"');
    expect(subagentSheet).toContain('label="Subagent conversation"');
    expect(subagentSheet).toContain("<SubagentConversationDetail");
    expect(fullscreenOverlay).toContain("fullscreen-overlay-suspense-fallback");
    expect(fullscreenOverlay).toContain('label="Fullscreen overlay content"');
    expect(fullscreenOverlay).toContain("onDismiss={() => close(entry.id)}");
  });

  it("opens a concrete subagent from agent activity instead of expanding an empty card", () => {
    const start = screen.indexOf("function AgentActivityProtocolBlock");
    const end = screen.indexOf("function DocumentAttachmentChip", start);
    const renderer = screen.slice(start, end);
    expect(renderer).toContain("subagentActivityTargetThreadId");
    expect(renderer).toContain('testID="subagent-activity-link"');
    expect(renderer).toContain('name="chevron-forward"');
    expect(renderer).toContain("containerStyle={styles.agentNavigationTitleWave}");
    expect(screen).toContain('agentNavigationTitleWave: { alignSelf: "flex-start", justifyContent: "center" }');
    expect(renderer).not.toContain("<Card");
    expect(screen).toContain('testID="subagent-activity-navigation"');
    expect(screen).toContain("if (agentNavigationOnly)");
  });
});
