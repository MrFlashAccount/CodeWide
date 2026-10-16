import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  newChat,
  ownerNewChatSubmission,
  projectWorkspaceAdapter,
  newChatProjectPicker,
  projectPickerContent,
  projectPickerRows,
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

const ownerActiveConversationScope = readFileSync(
  new URL("../../src/features/conversation/activeConversationScope.ts", import.meta.url),
  "utf8",
);

it("keeps a server-scoped new chat local until the first send", () => {
  expect(newChat).toContain("newThreadService.resumeOrOpen(connectionId, cwd)");
  expect(newChat).toContain("ensureV1NewThreadRoute(route.router, route.pathname");
  expect(newChat).toContain("project.projectWorkspace.defaultProjectCwd(connectionId)");
  expect(ownerActiveConversationScope).toContain('title: "New Chat"');
  expect(ownerConversationWorkspace).toMatch(
    /createConversationScopeBindings\(\s*props\.features,\s*scope\.newChatDraft !== null/u,
  );
  expect(ownerNewChatSubmission).toMatch(
    /await commands\.startThreadInWorkspace\(\s*draftChat\.connectionId,\s*draftChat\.cwd,\s*draftChat\.id,?\s*\)/u,
  );
  expect(projectWorkspaceAdapter).toContain(
    "startThread: async (cwd) => startThread(connectionId, cwd)",
  );
  expect(ownerNewChatSubmission).toContain("const commandId = await commands.sendText(");
  expect(ownerNewChatSubmission).toContain("{ ...options, workspaceRequestId: draftChat.id }");
  expect(newChatProjectPicker).toContain("function NewChatProjectPicker");
  expect(newChatProjectPicker).toContain("<ProjectPickerSurface");
  expect(screen).not.toContain("function NewThreadSheet");
  expect(ownerConversationEmptyState).toContain('testID="new-chat-empty-state"');
  expect(ownerConversationEmptyState).toContain("What would you like to work on?");
  expect(conversationOverlay).toContain("<ProjectPickerSheet");
  expect(projectPickerContent).toContain("<LegendList");
  expect(projectPickerContent).toContain("recycleItems");
  expect(projectPickerRows).toContain(
    'append("Recent", unpinnedProjects.slice(0, RECENT_PROJECT_LIMIT), "recent")',
  );
  expect(projectPickerRows).toContain(
    'append("Other", unpinnedProjects.slice(RECENT_PROJECT_LIMIT), "other")',
  );
  expect(projectPicker).not.toContain("<Accordion");
  expect(projectPickerHeader).toContain('accessibilityLabel="Manage Projects"');
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
