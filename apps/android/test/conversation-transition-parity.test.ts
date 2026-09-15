import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compactSource } from "./source-contract";

const screen = compactSource(readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8"));
const subagentSheet = readFileSync(new URL("../src/features/agents/SubagentSheet.tsx", import.meta.url), "utf8");
const resources = readFileSync(new URL("../src/data/workspace-resource-keys.ts", import.meta.url), "utf8");
const summaryHook = readFileSync(new URL("../src/data/use-thread-summary-view.ts", import.meta.url), "utf8");

const navigationActions = compactSource(readFileSync(new URL("../src/features/navigation/navigationActions.ts", import.meta.url), "utf8"));

const ownerThreadResourceContextChips = compactSource(readFileSync(new URL("../src/features/changes/ThreadResourceContextChips.tsx", import.meta.url), "utf8"));

const ownerConversationTimelineSurface = compactSource(readFileSync(new URL("../src/features/conversation/timeline/ConversationTimelineSurface.tsx", import.meta.url), "utf8"));
const ownerConversationDetail = compactSource(readFileSync(new URL("../src/features/conversation/ConversationDetail.tsx", import.meta.url), "utf8"));
const ownerReviewFeature = compactSource(readFileSync(new URL("../src/features/review/ReviewFeature.tsx", import.meta.url), "utf8"));

const workspaceOwner = compactSource(readFileSync(new URL("../src/features/conversation/ConversationWorkspace.tsx", import.meta.url), "utf8"));

const composition = compactSource(readFileSync(new URL("../src/features/conversation/ConversationComposition.tsx", import.meta.url), "utf8"));

const frame = compactSource(readFileSync(new URL("../src/features/conversation/ConversationFrame.tsx", import.meta.url), "utf8"));

const navigationBoundary = compactSource(readFileSync(new URL("../src/features/conversation/ConversationNavigationBoundary.tsx", import.meta.url), "utf8"));

const toolsOwner = compactSource(readFileSync(new URL("../src/features/conversation/ConversationTools.tsx", import.meta.url), "utf8"));

const ownerConversationWorkspaceContent = compactSource(readFileSync(new URL("../src/features/conversation/ConversationWorkspaceContent.tsx", import.meta.url), "utf8"));

const voiceProvider = compactSource(readFileSync(new URL("../src/features/workspace/WorkspaceConversationProviders.tsx", import.meta.url), "utf8"));
const workspaceView = compactSource(readFileSync(new URL("../src/features/conversation/ConversationWorkspaceContent.tsx", import.meta.url), "utf8"));

const destinationView = compactSource(readFileSync(new URL("../src/features/conversation/ConversationDestinationSurface.tsx", import.meta.url), "utf8"));

const publication = compactSource(readFileSync(new URL("../src/features/conversation/MainConversationPublication.tsx", import.meta.url), "utf8"));

describe("conversation transition parity", () => {
  it("reveals main-chat navigation immediately while retaining local Suspense and shared window loading", () => {
    const mainSelection = navigationActions.slice(
      navigationActions.indexOf("const setActiveThreadId ="),
      navigationActions.indexOf("const preloadThread ="),
    );
    const mainDetail = ownerConversationDetail;
    const mainBoundary = destinationView.slice(destinationView.indexOf('label="Conversation"'));
    const subagentSelection = subagentSheet.slice(
      subagentSheet.indexOf("const [selectedId"),
      subagentSheet.indexOf("return ("),
    );
    const subagentBoundary = subagentSheet.slice(
      subagentSheet.indexOf('label="Subagent conversation"'),
      subagentSheet.indexOf("function SubagentConversationDetail"),
    );
    const subagentDetail = subagentSheet.slice(
      subagentSheet.indexOf("function SubagentConversationDetail"),
      subagentSheet.indexOf("const detailRows"),
    );

    // Main-chat navigation now reveals cached data or a skeleton immediately;
    // retaining the previous destination until hydration is no longer its UX contract.
    expect(mainSelection).not.toContain("startThreadTransition(");
    expect(mainSelection).toContain("threadNavigation.select(value, reloadSelected)");
    expect(mainSelection).not.toContain("setThreadSelection(");
    const fallback = navigationBoundary.slice(navigationBoundary.indexOf("function ConversationNavigationLoader"), navigationBoundary.indexOf("function ConversationNavigationFallback"));
    expect(fallback).toContain("<MessageListSkeleton />");
    expect(fallback).not.toContain("<ActivityIndicator");
    expect(subagentSelection).toContain("startSubagentTransition(() => setSelectedId(threadId))");
    expect(mainBoundary.indexOf("<Suspense fallback=")).toBeLessThan(mainBoundary.indexOf("<ConversationDestination"));
    expect(subagentBoundary.indexOf("<Suspense fallback=")).toBeLessThan(subagentBoundary.indexOf("<SubagentConversationDetail"));
    expect(mainDetail).toContain("useThreadChatWindow(chatDatabase, chatWindowRequest, false)");
    expect(publication).toContain("searchState === null ? history.messageListState");
    expect(ownerConversationTimelineSurface).toContain("<MessageListBoundary state={messageListState}>");
    expect(subagentDetail).toContain("useThreadChatWindow(threadDetails, {");
    expect(publication).toContain("conversation.renderContent({");
    expect(ownerConversationWorkspaceContent).toContain("<ConversationComposition");
    expect(composition).not.toContain("key={navigationKey}");
    expect(mainDetail).not.toContain("key={navigationKey}");
  });

  it("has no compatibility surface or manual presentation gate", () => {
    expect(screen).not.toContain("ReactiveConversationSurface");
    expect(screen).not.toContain("ProjectedConversationDetail");
    expect(screen).not.toContain("mainRoute");
    expect(screen).not.toContain("pendingConversationRequest");
    expect(screen).not.toContain("useThreadChatWindowContent");
    expect(screen).not.toContain("AtomicConversationSurface");
    expect(screen).not.toContain("conversationNavigationReady");
    expect(screen).not.toContain("advanceConversationPresentation");
  });

  it("contains no demo-mode data path", () => {
    expect(screen).not.toMatch(/\bdemo\b/i);
    expect(screen).not.toContain("__CODEWIDE_TEST_WORKSPACE__");
    expect(screen).not.toContain("__CODEWIDE_TEST_THREAD__");
  });

  it("isolates destination summaries and chat materialization below the local boundary", () => {
    expect(summaryHook).toContain("...(viewId === undefined ? {} : { viewId }),");
    expect(ownerConversationDetail).toContain('viewId: `conversation:${connectionId}:${threadId}`');
    const workspaceVoiceRuntime = voiceProvider;
    expect(workspaceVoiceRuntime).not.toContain("threadDetails?.getThread");
    expect(workspaceVoiceRuntime).toContain("thread: null,");
    expect(workspaceVoiceRuntime).toContain("ConversationPane installs its own thread-scoped provider below Suspense.");
    expect(frame).toContain("<AppVoiceInputProvider runtime={appVoiceInputRuntime}>");
    expect(ownerReviewFeature).toContain("thread: remoteThread ?? null,");
  });

  it("keeps ancillary thread-resource refreshes out of the workspace and conversation owners", () => {
    const workspace = workspaceOwner;
    const pane = composition;

    expect(workspace).not.toContain("const activeThreadResources = useThreadResources(");
    expect(workspaceView).toContain("threadResourcesModel: props.runtime.resources?.threadResources ?? null");
    expect(pane).not.toContain("useThreadResources(");
    expect(toolsOwner).toContain("<ThreadResourceContextChips");
    expect(ownerThreadResourceContextChips).toContain("const resource = useThreadResources(model, resourceId, () => load(), { revision });");
  });

  it("keeps local presentation state stable across ordinary reopenings", () => {
    expect(resources).toContain("export function threadHistoryResourceKey(connectionId: string, threadId: string): string");
    expect(resources).toContain("return `${connectionId}\\u0000${threadId}`;");
    expect(resources).not.toContain("threadHistoryResourceKey(connectionId: string, threadId: string, generation");
    expect(ownerConversationDetail).toContain("threadHistoryResourceKey(connectionId, threadId)");
  });
});
