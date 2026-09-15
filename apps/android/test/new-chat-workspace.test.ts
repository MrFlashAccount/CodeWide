import { compactSource } from "./source-contract";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
const detailDatabase = readFileSync(new URL("../src/data/thread-detail-database.native.ts", import.meta.url), "utf8");

const emptyStateOwner = compactSource(readFileSync(new URL("../src/features/conversation/ConversationEmptyState.tsx", import.meta.url), "utf8"));

const workspaceOwner = compactSource(readFileSync(new URL("../src/features/projects/newChatSubmission.ts", import.meta.url), "utf8"));

describe("new chat workspace selector", () => {
  it("shows the second-row dropdown only after plugin capability inspection", () => {
    const emptyStateStart = emptyStateOwner.indexOf('testID="new-chat-empty-state"');
    const emptyStateEnd = emptyStateOwner.indexOf("</View>", emptyStateStart);
    const emptyState = emptyStateOwner.slice(emptyStateStart, emptyStateEnd);

    expect(emptyState).toContain("workspaceSupport !== null");
    expect(emptyState).toContain('label: "In this folder"');
    expect(emptyState).toContain('label: "New workspace"');
    expect(emptyState.indexOf("Change project")).toBeLessThan(emptyState.indexOf("Choose workspace mode"));
  });

  it("creates an isolated workspace before starting the thread", () => {
    const sendStart = workspaceOwner.indexOf('if (draftChat.workspaceMode === "isolated")');
    const sendEnd = workspaceOwner.indexOf("const commandId = await commands.sendText", sendStart);
    expect(sendStart).toBeGreaterThanOrEqual(0);
    expect(sendEnd).toBeGreaterThan(sendStart);
    const send = workspaceOwner.slice(sendStart, sendEnd);

    expect(send).toContain("await commands.startThreadInWorkspace");
    expect(send).toContain("draftChat.id");
    expect(workspaceOwner.slice(sendStart, sendStart + 1_600)).toContain("workspaceRequestId: draftChat.id");
  });

  it("keeps the newly started shell resident until its first turn completes", () => {
    const applyEventsStart = detailDatabase.indexOf("async applyEvents(connectionId, events)");
    const importThreadStart = detailDatabase.indexOf("async importThreadSnapshot(connectionId, thread, _reason, historyCursor)");
    const lifecycle = detailDatabase.slice(applyEventsStart, importThreadStart + 1_800);

    expect(lifecycle).toContain("startedThreadShells.has(threadScope(connectionId, threadId))");
    expect(lifecycle).toContain("if (!hasLoadedThread && startedThreadIds.size === 0)");
    expect(lifecycle).toContain("const controls = ensureControls()");
    expect(lifecycle).toContain('await publishThread(connectionId, shell, "live")');
    expect(lifecycle).toContain("projectionOperationClosesStartedShell(patch.operation.kind)");
    expect(lifecycle).not.toContain('method === "turn/completed"');
    expect(lifecycle).toContain("if (thread.turns.length === 0)");
  });
});
