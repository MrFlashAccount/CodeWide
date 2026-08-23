import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
const timelineList = readFileSync(new URL("../src/rendering/ThreadTimelineList.tsx", import.meta.url), "utf8");
const commitProbe = readFileSync(new URL("../src/ui/CommitProbe.tsx", import.meta.url), "utf8");
const projectCatalog = readFileSync(new URL("../src/data/use-remote-project-catalog.ts", import.meta.url), "utf8");
const historyController = readFileSync(new URL("../src/data/use-thread-history-controller.ts", import.meta.url), "utf8");
const subagentSheet = readFileSync(new URL("../src/ui/SubagentSheet.tsx", import.meta.url), "utf8");
const documentPreview = readFileSync(new URL("../src/rendering/DocumentPreviewHost.tsx", import.meta.url), "utf8");
const codeReview = readFileSync(new URL("../src/rendering/CodeReviewWorkspace.tsx", import.meta.url), "utf8");

describe("CodeWide effect ownership", () => {
  it("keeps the workspace screen free of post-commit state orchestration", () => {
    expect(screen).not.toMatch(/\buseEffect\s*\(/u);
    expect(screen).not.toMatch(/\buseLayoutEffect\s*\(/u);
    expect(screen).not.toContain("transitionConversationScope");
    expect(screen).toContain("useRemoteProjectCatalog(");
    expect(screen).toContain("useDeepLinkListener(");
    expect(screen).toContain("useComposerLatestValues(");
    expect(screen).toContain("useAndroidBackHandler(");
    expect(screen).toContain("useSecondClock(");
    expect(screen).toContain("<CommitOnChangeProbe");
    expect(screen).toContain("<EveryCommitProbe");
    expect(screen).not.toContain('<Profiler id="thread-timeline-navigation"');
    expect(screen).not.toContain('<Profiler id="thread-row"');
    expect(commitProbe).toContain("useLayoutEffect(() => commit());");
  });

  it("resets conversation-local state by identity instead of an effect cascade", () => {
    expect(screen).toContain("<ConversationPane\n        key={navigationKey}");
    expect(screen).toContain("const chatWindow = useThreadChatWindow(chatDatabase, chatWindowRequest)");
    expect(screen).toContain("function MainConversationDetail(");
    expect(screen).toContain("function ConversationDestination(");
    expect(screen).not.toContain("advanceConversationPresentation(");
    expect(screen).not.toContain("AtomicConversationSurface");
    expect(screen).not.toContain("ReactiveConversationSurface");
    expect(screen).not.toContain('`${requestedThreadId ?? activeThreadKey ?? "none"}\\u0001${threadOpenGeneration}`');
    expect(screen).toContain("useConversationOwner(composerScope)");
  });

  it("synchronizes unread acknowledgement and release telemetry at commit boundaries", () => {
    expect(screen).toContain("revision={latestUnreadReceiptKey}");
    expect(screen).toContain("acknowledgedUnreadReceiptKeyRef.current = null");
    expect(screen).toContain("activeThreadNavigationIdFor(connectionId, threadId)");
    expect(screen).toContain("cancelAnimationFrame(nextFrameRef.current)");
    expect(screen).toContain("}, navigationId);");
  });

  it("keeps the one layout synchronization at the LegendList cache boundary", () => {
    expect(timelineList).toContain("useLayoutEffect(() => {");
    expect(timelineList).toContain('clearCaches({ mode: "sizes" })');
    expect(screen).toContain("measurementRevision={windowLayout.measurementRevision}");
    expect(screen).not.toContain('key={`timeline-layout:${windowLayout.measurementRevision}`}');
  });

  it("never starts data loading from a React effect", () => {
    const projectCatalogEffects = projectCatalog.match(/useEffect\s*\([\s\S]*?\n\s*\}, \[[^\]]*\]\);/gu) ?? [];
    expect(projectCatalogEffects).toHaveLength(1);
    expect(projectCatalogEffects[0]).toContain("remoteProjectCatalogModel.retain(connectionId)");
    expect(projectCatalogEffects[0]).not.toMatch(/\b(?:load|resource|listProjects)\s*\(/u);
    expect(historyController).not.toMatch(/\buseEffect\s*\(/u);
    expect(subagentSheet).not.toMatch(/\buse(?:Layout)?Effect\s*\(/u);
    expect(documentPreview).not.toMatch(/\buse(?:Layout)?Effect\s*\(/u);
    const codeReviewEffects = codeReview.match(/useEffect\s*\([\s\S]*?\n\s*\}, \[[^\]]*\]\);/gu) ?? [];
    expect(codeReviewEffects).toHaveLength(1);
    expect(codeReviewEffects[0]).toContain("voiceController?.unbind(voiceScope)");
    expect(codeReviewEffects[0]).not.toMatch(/\b(?:load|read|fetch|refresh)[A-Z_a-z]*\s*\(/u);
  });

  it("keeps chat-adjacent resources in granular owners while voice capture stays global", () => {
    const workspace = screen.slice(
      screen.indexOf("function CodeWideWorkspaceScreen"),
      screen.indexOf("function ComposerControlChips"),
    );
    expect(workspace).not.toContain("useTurnControlsRow(");
    expect(workspace).not.toContain("useBackgroundTerminalsRow(");
    expect(workspace).not.toContain("useThreadGoalRow(");
    expect(workspace).not.toContain("useTunnelRow(");
    expect(workspace).not.toContain("useNativePortForwarding(");
    expect(workspace).not.toContain("new SubagentListProjection");
    expect(workspace).toContain("const activeVoiceQuery = useLiveQuery(");
    expect(workspace).toContain("const activeReviewVoiceQuery = useLiveQuery(");
    expect(workspace).toContain("const voiceInputsQuery = useLiveQuery(");
    expect(screen).toContain("function ComposerControlChips(");
    expect(screen).toContain("const resource = useTurnControlsRow(resources, resourceId);");
    expect(screen).toContain("function ComposerPortContextChipLoaded(");
    expect(screen).toContain("const snapshot = useNativePortForwarding(connectionId);");
    expect(screen).toContain("const workspace = useInteractiveTerminalWorkspace(connectionId, threadId);");
    expect(screen).toContain("function ComposerSubagentContextChipLoaded(");
    expect(screen).toContain("const terminalsResource = useBackgroundTerminalsRow(resources, backgroundTerminalsResourceId);");
    expect(screen).toContain("const goalResource = useThreadGoalRow(resources, goalResourceId);");
    expect(screen).toContain("const tunnelResource = useTunnelRow(resources, tunnelResourceId);");
  });
});
