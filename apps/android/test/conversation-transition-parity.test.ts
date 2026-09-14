import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compactSource } from "./source-contract";

const screen = compactSource(readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8"));
const subagentSheet = readFileSync(new URL("../src/ui/SubagentSheet.tsx", import.meta.url), "utf8");
const resources = readFileSync(new URL("../src/data/workspace-resource-database.ts", import.meta.url), "utf8");
const summaryHook = readFileSync(new URL("../src/data/use-thread-summary-view.ts", import.meta.url), "utf8");

describe("conversation transition parity", () => {
  it("reveals main-chat navigation immediately while retaining local Suspense and shared window loading", () => {
    const mainSelection = screen.slice(
      screen.indexOf("const setActiveThreadId ="),
      screen.indexOf("const preloadThread ="),
    );
    const mainDetail = screen.slice(
      screen.indexOf("function MainConversationDetail"),
      screen.indexOf("type NewConversationDetailProps"),
    );
    const mainBoundary = screen.slice(
      screen.indexOf('label="Conversation"'),
      screen.indexOf('label="Conversation"') + 2_000,
    );
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
    const fallback = screen.slice(screen.indexOf("function ConversationNavigationLoader"), screen.indexOf("function ConversationNavigationFallback"));
    expect(fallback).toContain("<MessageListSkeleton />");
    expect(fallback).not.toContain("<ActivityIndicator");
    expect(subagentSelection).toContain("startSubagentTransition(() => setSelectedId(threadId))");
    expect(mainBoundary.indexOf("<Suspense fallback=")).toBeLessThan(mainBoundary.indexOf("<ConversationDestination"));
    expect(subagentBoundary.indexOf("<Suspense fallback=")).toBeLessThan(subagentBoundary.indexOf("<SubagentConversationDetail"));
    expect(mainDetail).toContain("useThreadChatWindow(chatDatabase, chatWindowRequest, false)");
    expect(mainDetail).toContain("searchState === null ? messageListState");
    expect(screen).toContain("<MessageListBoundary state={messageListState}>");
    expect(subagentDetail).toContain("useThreadChatWindow(threadDetails, {");
    expect(mainDetail).toContain("<ConversationPane");
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
    expect(screen).toContain('viewId: `conversation:${connectionId}:${threadId}`');
    const workspaceVoiceRuntime = screen.slice(
      screen.indexOf("const voiceInputRuntime: AppVoiceInputRuntime"),
      screen.indexOf("type SelectWorkspaceThread"),
    );
    expect(workspaceVoiceRuntime).not.toContain("threadDetails?.getThread");
    expect(workspaceVoiceRuntime).toContain("thread: null,");
    expect(workspaceVoiceRuntime).toContain("ConversationPane installs its own thread-scoped provider below Suspense.");
    expect(screen).toContain("<AppVoiceInputProvider runtime={appVoiceInputRuntime}>");
    expect(screen).toContain("thread: remoteThread ?? null,");
  });

  it("keeps ancillary thread-resource refreshes out of the workspace and conversation owners", () => {
    const workspace = screen.slice(
      screen.indexOf("function CodeWideWorkspaceScreen"),
      screen.indexOf("function ConversationPane"),
    );
    const pane = screen.slice(
      screen.indexOf("function ConversationPane"),
      screen.indexOf("type ThreadResourceDocumentRoute"),
    );

    expect(workspace).not.toContain("const activeThreadResources = useThreadResources(");
    expect(workspace).toContain("threadResourcesModel={remote.resourceDatabase?.threadResources ?? null}");
    expect(pane).not.toContain("useThreadResources(");
    expect(pane).toContain("<ThreadResourceContextChips");
    expect(screen).toContain("const resource = useThreadResources(model, resourceId, () => load(), { revision });");
  });

  it("keeps local presentation state stable across ordinary reopenings", () => {
    expect(resources).toContain("export function threadHistoryResourceKey(connectionId: string, threadId: string): string");
    expect(resources).toContain("return `${connectionId}\\u0000${threadId}`;");
    expect(resources).not.toContain("threadHistoryResourceKey(connectionId: string, threadId: string, generation");
    expect(screen).toContain("threadHistoryResourceKey(connectionId, threadId)");
  });
});
