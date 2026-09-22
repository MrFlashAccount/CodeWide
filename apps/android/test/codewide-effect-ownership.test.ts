import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compactSource } from "./source-contract";

const runtimeShell = compactSource(
  readFileSync(new URL("../app/(workspace)/_layout.tsx", import.meta.url), "utf8"),
);
const workspaceComposition = compactSource(
  readFileSync(new URL("../src/routeComposition/WorkspaceRouteComposition.tsx", import.meta.url), "utf8"),
);
const workspaceRouteModel = compactSource(
  readFileSync(new URL("../src/routeComposition/WorkspaceRouteModel.ts", import.meta.url), "utf8"),
);
const workspaceVisualShell = compactSource(
  readFileSync(new URL("../src/routeComposition/WorkspaceShell.tsx", import.meta.url), "utf8"),
);
const screen = [runtimeShell, workspaceComposition, workspaceRouteModel, workspaceVisualShell].join(
  " ",
);
const timelineList = readFileSync(
  new URL("../src/rendering/ThreadTimelineList.tsx", import.meta.url),
  "utf8",
);
const commitProbe = readFileSync(new URL("../src/ui/CommitProbe.tsx", import.meta.url), "utf8");
const projectCatalog = readFileSync(
  new URL("../src/features/projects/useRemoteProjectCatalog.ts", import.meta.url),
  "utf8",
);
const historyController = readFileSync(
  new URL("../src/data/use-thread-history-controller.ts", import.meta.url),
  "utf8",
);
const subagentSheet = readFileSync(
  new URL("../src/features/agents/SubagentSheet.tsx", import.meta.url),
  "utf8",
);
const documentPreview = readFileSync(
  new URL("../src/rendering/DocumentPreviewHost.tsx", import.meta.url),
  "utf8",
);
const codeReview = readFileSync(
  new URL("../src/features/review/workspace/CodeReviewWorkspace.tsx", import.meta.url),
  "utf8",
);

const projectWorkspace = compactSource(
  readFileSync(new URL("../src/features/projects/projectWorkspace.ts", import.meta.url), "utf8"),
);
const threadSidebar = compactSource(
  readFileSync(new URL("../src/features/threadList/ThreadSidebar.tsx", import.meta.url), "utf8"),
);
const selectableThread = compactSource(
  readFileSync(
    new URL("../src/features/threadList/SelectableThreadRow.tsx", import.meta.url),
    "utf8",
  ),
);

const workspaceDeepLinks = compactSource(
  readFileSync(
    new URL("../src/features/workspace/useV1WorkspaceDeepLinks.ts", import.meta.url),
    "utf8",
  ),
);
const pairingRouteSessions = compactSource(
  readFileSync(
    new URL("../src/services/connections/pairingRouteSession.ts", import.meta.url),
    "utf8",
  ),
);
const newServerRoute = compactSource(
  readFileSync(new URL("../app/(workspace)/settings/servers/new/index.tsx", import.meta.url), "utf8"),
);

const reviewVoiceOwner = readFileSync(
  new URL("../src/features/review/comments/reviewVoice.ts", import.meta.url),
  "utf8",
);

const ownerComposerPortContextChip = compactSource(
  readFileSync(
    new URL("../src/features/ports/ComposerPortContextChip.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerComposerSubagentContextChip = compactSource(
  readFileSync(
    new URL("../src/features/agents/ComposerSubagentContextChip.tsx", import.meta.url),
    "utf8",
  ),
);

const ownerComposerTerminalContextChip = readFileSync(
  new URL("../src/features/terminal/ComposerTerminalContextChip.tsx", import.meta.url),
  "utf8",
);

const ownerDraft = compactSource(
  readFileSync(new URL("../src/features/composer/draft.ts", import.meta.url), "utf8"),
);
const ownerOverlayScrollOwnership = compactSource(
  readFileSync(
    new URL("../src/features/conversation/timeline/overlayScrollOwnership.ts", import.meta.url),
    "utf8",
  ),
);
const ownerVoiceCaptureStatus = compactSource(
  readFileSync(
    new URL("../src/features/composer/voice/VoiceCaptureStatus.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerConversationDetail = compactSource(
  readFileSync(
    new URL("../src/features/conversation/ConversationDetail.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerConversationDestination = compactSource(
  readFileSync(
    new URL("../src/features/conversation/ConversationDestination.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerConversationTimelineSurface = compactSource(
  readFileSync(
    new URL(
      "../src/features/conversation/timeline/ConversationTimelineSurface.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
);
const ownerUnreadReceipt = compactSource(
  readFileSync(
    new URL("../src/features/conversation/timeline/unreadReceipt.ts", import.meta.url),
    "utf8",
  ),
);
const ownerThreadTimelineNavigationCommit = compactSource(
  readFileSync(
    new URL(
      "../src/features/conversation/timeline/ThreadTimelineNavigationCommit.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
);
const ownerTimelineViewport = compactSource(
  readFileSync(
    new URL("../src/features/conversation/timeline/TimelineViewport.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerComposerControlChips = compactSource(
  readFileSync(
    new URL("../src/features/composer/settings/ComposerControlChips.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerComposerMenuComposition = compactSource(
  readFileSync(
    new URL("../src/features/composer/ComposerRuntimeRoutes.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerConversationWorkspace = compactSource(
  readFileSync(
    new URL("../src/features/conversation/ConversationWorkspace.tsx", import.meta.url),
    "utf8",
  ),
);

const anchor = compactSource(
  readFileSync(
    new URL("../src/features/conversation/timeline/historyAnchor.ts", import.meta.url),
    "utf8",
  ),
);

const search = compactSource(
  readFileSync(
    new URL("../src/features/conversation/timeline/timelineSearch.ts", import.meta.url),
    "utf8",
  ),
);

const activation = compactSource(
  readFileSync(
    new URL("../src/features/conversation/conversationActivation.ts", import.meta.url),
    "utf8",
  ),
);

const composition = compactSource(
  readFileSync(
    new URL("../src/features/conversation/ConversationComposition.tsx", import.meta.url),
    "utf8",
  ),
);

const workspaceShell = screen;
const activeProjectSelection = compactSource(
  readFileSync(
    new URL("../src/features/projects/activeProjectSelection.ts", import.meta.url),
    "utf8",
  ),
);

const ownerMainConversationPublication = compactSource(
  readFileSync(
    new URL("../src/features/conversation/MainConversationPublication.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerConversationDestinationSurface = compactSource(
  readFileSync(
    new URL("../src/features/conversation/ConversationDestinationSurface.tsx", import.meta.url),
    "utf8",
  ),
);

const workspaceView = workspaceVisualShell;
const threadNavigation = compactSource(
  readFileSync(
    new URL("../src/services/threads/threadNavigationService.ts", import.meta.url),
    "utf8",
  ),
);

describe("CodeWide effect ownership", () => {
  it("keeps the workspace route effect limited to native runtime synchronization", () => {
    expect(runtimeShell.match(/\buseEffect\s*\(/gu)).toHaveLength(1);
    expect(runtimeShell).not.toMatch(/\buseLayoutEffect\s*\(/u);
    expect(runtimeShell).toContain("activateRuntime(");
    expect(runtimeShell).toContain("stopRuntime()");
    expect(screen).not.toContain("transitionConversationScope");
    expect(projectWorkspace).toContain("useRemoteProjectCatalog(");
    expect(workspaceDeepLinks).not.toMatch(/\b(?:fetch|load|hydrate)[A-Z_a-z]*\s*\(/u);
    expect(workspaceDeepLinks).toContain("parseThreadDeepLink(raw)");
    expect(workspaceDeepLinks).toContain("selectThread(threadSelectionKey({");
    expect(workspaceDeepLinks).toContain("id: parsed.threadId");
    expect(workspaceDeepLinks).toContain("serverId: parsed.connectionId");
    expect(workspaceComposition).toContain(
      "const session = pairingRouteSessions.open(initialCode)",
    );
    expect(workspaceComposition).toContain("params: { sessionId: session.id }");
    expect(workspaceComposition).not.toContain("params: { initialCode }");
    expect(pairingRouteSessions).toContain(
      "new RouteSessionRegistry<PairingRouteSession>({ limit: MAX_PAIRING_SESSIONS",
    );
    expect(newServerRoute).toContain("initialCode={routeSession?.initialCode ?? null}");
    expect(ownerDraft).toContain("useComposerSession(");
    expect(ownerOverlayScrollOwnership).toContain("useAndroidBackHandler(");
    expect(ownerVoiceCaptureStatus).toContain("useSecondClock(");
    expect(ownerMainConversationPublication).toContain("<CommitOnChangeProbe");
    expect(ownerConversationTimelineSurface).toContain("<EveryCommitProbe");
    expect(screen).not.toContain('<Profiler id="thread-timeline-navigation"');
    expect(screen).not.toContain('<Profiler id="thread-row"');
    expect(commitProbe).toContain("useLayoutEffect(() => commit());");
  });

  it("resets conversation-local state by identity instead of an effect cascade", () => {
    expect(screen).not.toContain("<ConversationPane\n        key={navigationKey}");
    expect(anchor).toContain("useConversationCleanup(composerScope,");
    expect(search).toContain("useConversationState(composerScope,");
    expect(ownerConversationDetail).toContain(
      "const chatWindow = useThreadChatWindow(chatDatabase, chatWindowRequest, false)",
    );
    expect(ownerConversationDetail).toContain("function MainConversationDetail(");
    expect(ownerConversationDestination).toContain("function ConversationDestination(");
    expect(screen).not.toContain("advanceConversationPresentation(");
    expect(screen).not.toContain("AtomicConversationSurface");
    expect(screen).not.toContain("ReactiveConversationSurface");
    expect(screen).not.toContain(
      '`${requestedThreadId ?? activeThreadKey ?? "none"}\\u0001${threadOpenGeneration}`',
    );
    expect(activation).toContain("useConversationOwner(composerScope)");
  });

  it("synchronizes unread acknowledgement and release telemetry at commit boundaries", () => {
    expect(ownerConversationTimelineSurface).toContain("revision={latestUnreadReceiptKey}");
    expect(ownerUnreadReceipt).toContain("acknowledgedUnreadReceiptKeyRef.current = null");
    expect(ownerMainConversationPublication).not.toContain("finishPresentation");
    expect(threadNavigation).not.toContain("beginPresentation");
    expect(screen).not.toContain("onTimelineFirstDraw");
    expect(ownerThreadTimelineNavigationCommit).toContain(
      "activeThreadNavigationIdFor(connectionId, threadId)",
    );
    expect(ownerThreadTimelineNavigationCommit).toContain(
      "cancelAnimationFrame(nextFrameRef.current)",
    );
    expect(ownerMainConversationPublication).toContain(
      '"conversation_destination_hidden_or_unmounted", {}, navigationId',
    );
  });

  it("invalidates the LegendList cache only from a native measurement event", () => {
    expect(timelineList).toContain("subscribeMeasurementInvalidation(invalidateMeasurements)");
    expect(timelineList).toContain('clearCaches({ mode: "sizes" })');
    expect(timelineList).not.toContain("useLayoutEffect");
    expect(ownerTimelineViewport).not.toContain("measurementRevision={");
    expect(screen).not.toContain("key={`timeline-layout:${windowLayout.measurementRevision}`}");
  });

  it("never starts data loading from a React effect", () => {
    const projectCatalogEffects =
      projectCatalog.match(/useEffect\s*\([\s\S]*?\s*\},\s*\[[^\]]*\],?\s*\);/gu) ?? [];
    expect(projectCatalogEffects).toHaveLength(1);
    expect(projectCatalogEffects[0]).toContain("remoteProjectCatalogModel.retain(connectionId)");
    expect(projectCatalogEffects[0]).not.toMatch(/\b(?:load|resource|listProjects)\s*\(/u);
    expect(historyController).not.toMatch(/\buseEffect\s*\(/u);
    expect(subagentSheet).not.toMatch(/\buse(?:Layout)?Effect\s*\(/u);
    expect(documentPreview).not.toMatch(/\buse(?:Layout)?Effect\s*\(/u);
    expect(codeReview).not.toMatch(/\buse(?:Layout)?Effect\s*\(/u);
    const codeReviewEffects =
      reviewVoiceOwner.match(/useEffect\s*\([\s\S]*?\s*\},\s*\[[^\]]*\],?\s*\);/gu) ?? [];
    expect(codeReviewEffects).toHaveLength(1);
    expect(codeReviewEffects[0]).toContain("voiceController?.unbind(scope)");
    expect(codeReviewEffects[0]).not.toMatch(/\b(?:load|read|fetch|refresh)[A-Z_a-z]*\s*\(/u);
  });

  it("does not fetch every server project catalog while painting the all-servers thread list", () => {
    expect(projectWorkspace).toContain(
      'const projectCatalogConnections = searchVisible || serverScope.kind === "all"',
    );
    expect(activeProjectSelection).toContain('activeConnectionId === ""');
    expect(projectWorkspace).toContain(
      "useRemoteProjectCatalog( remote.native, projectCatalogConnections, remote.listProjects,",
    );
  });

  it("keeps chat-adjacent resources in granular owners while voice capture stays global", () => {
    const workspace = workspaceShell;
    expect(workspace).not.toContain("useTurnControlsRow(");
    expect(workspace).not.toContain("useBackgroundTerminalsRow(");
    expect(workspace).not.toContain("useThreadGoalRow(");
    expect(workspace).not.toContain("useTunnelRow(");
    expect(workspace).not.toContain("useNativePortForwarding(");
    expect(workspace).not.toContain("new SubagentListProjection");
    expect(workspace).not.toContain("useLiveQuery(");
    expect(reviewVoiceOwner).toContain("useVoiceInputResource(voiceRuntime, voiceScope)");
    expect(workspaceView).toContain("<WorkspaceVoiceAura");
    expect(ownerComposerControlChips).toContain("function ComposerControlChips(");
    expect(ownerComposerControlChips).toContain(
      "const resource = useTurnControlsRow(resources, resourceId);",
    );
    expect(ownerComposerPortContextChip).toContain("function ComposerPortContextChipLoaded(");
    expect(ownerComposerPortContextChip).toContain(
      "const snapshot = useNativePortForwarding(connectionId);",
    );
    expect(ownerComposerTerminalContextChip).toContain(
      "const workspace = useInteractiveTerminalWorkspace(connectionId, threadId);",
    );
    expect(ownerComposerSubagentContextChip).toContain(
      "function ComposerSubagentContextChipLoaded(",
    );
    expect(ownerComposerMenuComposition).toContain(
      "const terminals = useBackgroundTerminalsRow( request.resources, request.backgroundTerminalsResourceId, );",
    );
    expect(ownerComposerMenuComposition).toContain(
      "const tunnel = useTunnelRow(request.resources, request.tunnelResourceId);",
    );
  });

  it("keeps active-thread selection below the workspace shell and out of the sidebar list", () => {
    expect(workspaceShell).toContain("v1ThreadRouteParams(routeParams)");
    expect(workspaceShell).not.toContain("createThreadNavigationModel");
    expect(workspaceShell).not.toContain("threadNavigation.destination$");
    // Link dispatch and mounted-screen reuse are covered by v1-app-link and workspace navigation render tests.
    expect(threadNavigation).toContain("const selectThread = useEvent");
    expect(threadSidebar).toContain("function ThreadSidebar(");
    expect(selectableThread).toContain("function SelectableThreadRow(");
    expect(selectableThread).toContain("selectedThreadKey === selectionKey");
    // Explicit selection with cached rows and width changes is verified by
    // workspace-navigation.render.test.tsx; the former default-thread effect is retired.
    expect(screen).not.toContain("setThreadSelection(threadNavigation.select(defaultThreadId))");
    expect(screen).not.toContain("extraData={`${activeThreadId");
  });
});
