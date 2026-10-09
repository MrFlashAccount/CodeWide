import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  newChat,
  ownerNewChatSubmission,
  projectWorkspaceAdapter,
  projectPickerContent,
  projectPicker,
  projectPickerHeader,
} from "./projects-sources";
import {
  ownerConversationWorkspace,
  ownerConversationEmptyState,
  conversationOverlay,
} from "./conversation-composition-sources";
import { screen } from "./platform-sources";
import { turnControlsOwner } from "./runtime-sources";
import { ownerComposerMenu } from "./composer-sources";
import { threadDetailDatabase } from "./thread-runtime-sources";
import { nativeTransport } from "./native-sources";
import type { ProjectPickerChoice } from "../../src/features/projects/projectPickerContract";
import { useProjectPickerRows } from "../../src/features/projects/projectPickerRows";

function pickerChoice(index: number, pinned = false): ProjectPickerChoice {
  return {
    project: {
      addedAt: index,
      lastUsedAt: index,
      name: `project-${String(index)}`,
      path: `/work/project-${String(index)}`,
      pinned,
    },
    server: { available: true, iconId: "server", id: "orbit", name: "Orbit" },
  };
}

const ownerProjectPickerFooter = readFileSync(new URL("../../src/features/projects/ProjectPickerFooter.tsx", import.meta.url), "utf8");
const ownerActiveConversationScope = readFileSync(new URL("../../src/features/conversation/activeConversationScope.ts", import.meta.url), "utf8");

it("keeps a server-scoped new chat local until the first send", () => {
  // The draft server is resolved locally (scope, current thread, then a live
  // server) without changing the list filter; see v1-new-chat-entry for behavior.
  expect(newChat).toContain("newChatDefaultServer(preferredId ?? null, list.servers)");
  expect(newChat).toContain(
    "openNewThread(connectionId, project.projectWorkspace.defaultProjectCwd(connectionId))",
  );
  expect(ownerActiveConversationScope).toContain("title: \"New Chat\"");
  expect(ownerConversationWorkspace).toMatch(
    /createConversationScopeBindings\(\s*props\.features,\s*scope\.newChatDraft !== null/u,
  );
  expect(ownerNewChatSubmission).toMatch(
    /await commands\.startThreadInWorkspace\(\s*draftChat\.connectionId,\s*draftChat\.cwd,\s*\{\s*agent,\s*requestId: draftChat\.id,?\s*\}\s*\)/u,
  );
  expect(projectWorkspaceAdapter).toContain(
    "startThread: async (cwd) => startThread(connectionId, cwd, start.agent ?? undefined)",
  );
  expect(ownerNewChatSubmission).toContain("const commandId = await commands.sendText(");
  expect(ownerNewChatSubmission).toContain("{ ...options, workspaceRequestId: draftChat.id }");
  expect(screen).not.toContain("function NewThreadSheet");
  expect(ownerConversationEmptyState).toContain('testID="new-chat-empty-state"');
  expect(ownerConversationEmptyState).toContain("What would you like to work on?");
  expect(conversationOverlay).toContain("<ProjectPickerSheet");
  expect(projectPickerContent).toContain("<LegendList");
  expect(projectPickerContent).toContain("recycleItems");
  // Recent keeps the eight newest unpinned projects; the rest collapse into
  // Other, and both expand by stable section id rather than by title.
  const { projectRows } = useProjectPickerRows(
    [pickerChoice(0, true), ...Array.from({ length: 10 }, (_, index) => pickerChoice(index + 1))],
    "",
    new Set(["recent"]),
  );
  expect(
    projectRows.flatMap((row) =>
      row.kind === "section" ? [[row.title, row.sectionId, row.count, row.expanded]] : [],
    ),
  ).toEqual([
    ["Pinned", null, 1, true],
    ["Recent", "recent", 8, true],
    ["Other", "other", 2, false],
  ]);
  expect(projectRows.filter((row) => row.kind === "project")).toHaveLength(9);
  expect(projectPicker).not.toContain("<Accordion");
  // Folder browsing for a draft moved from the header plus into a compact
  // footer entry; the header keeps only project management.
  expect(projectPickerHeader).toContain('accessibilityLabel="Manage Projects"');
  expect(projectPickerHeader).not.toContain('accessibilityLabel="Add project"');
  expect(ownerProjectPickerFooter).toContain('accessibilityLabel="Choose another folder"');
  expect(ownerProjectPickerFooter).toContain("state.openDirectoryPicker(state.serverFilter)");
  expect(projectWorkspaceAdapter).toContain(
    "const started = seedThreadExecutionSettings(response.thread",
  );
  expect(projectWorkspaceAdapter).toContain("model: response.model");
  expect(projectWorkspaceAdapter).toContain("effort: response.reasoningEffort");
  expect(projectWorkspaceAdapter).toContain("void loadTurnControls(connectionId, started.cwd)");
  expect(turnControlsOwner).toMatch(/"config\/read",\s*\{\s*cwd,\s*includeLayers: false,?\s*\}/u);
  expect(turnControlsOwner).toContain("isDefault: model.isDefault");
  expect(ownerComposerMenu).toMatch(/composerModelSettings\(\s*newChat,\s*serverExecution,/u);
  expect(threadDetailDatabase).toContain("const chat = createThreadChatModel({");
  expect(nativeTransport).toContain('typeof bridge.listPortForwards !== "function"');
});
