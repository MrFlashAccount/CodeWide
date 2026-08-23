import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
const subagentSheet = readFileSync(new URL("../src/ui/SubagentSheet.tsx", import.meta.url), "utf8");
const resources = readFileSync(new URL("../src/data/workspace-resource-database.ts", import.meta.url), "utf8");
const summaryHook = readFileSync(new URL("../src/data/use-thread-summary-view.ts", import.meta.url), "utf8");

describe("conversation transition parity", () => {
  it("uses the same transition, local Suspense and chat-window resource path as subagents", () => {
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

    expect(mainSelection).toContain("startThreadTransition(() => {");
    expect(subagentSelection).toContain("startSubagentTransition(() => setSelectedId(threadId))");
    expect(mainBoundary.indexOf("<Suspense fallback=")).toBeLessThan(mainBoundary.indexOf("<ConversationDestination"));
    expect(subagentBoundary.indexOf("<Suspense fallback=")).toBeLessThan(subagentBoundary.indexOf("<SubagentConversationDetail"));
    expect(mainDetail).toContain("useThreadChatWindow(chatDatabase, chatWindowRequest)");
    expect(subagentDetail).toContain("useThreadChatWindow(threadDetails, {");
    expect(mainDetail).toContain("<ConversationPane\n        key={navigationKey}");
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
      screen.indexOf("const openActiveLoopbackLink"),
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
