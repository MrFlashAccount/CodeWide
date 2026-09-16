import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  newChat,
  ownerNewChatSubmission,
  projectWorkspaceAdapter,
  newThreadServerSheet,
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

const ownerActiveConversationScope = readFileSync(new URL("../../src/features/conversation/activeConversationScope.ts", import.meta.url), "utf8");

it("keeps a server-scoped new chat local until the first send", () => {
  expect(newChat).toContain("resolveNewThreadRoute({");
  expect(newChat).toContain(
    "project.projectWorkspace.defaultProjectCwd(destination.serverId)",
  );
  expect(ownerActiveConversationScope).toContain("title: \"New Chat\"");
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
  expect(newThreadServerSheet).toContain("function NewThreadServerSheet");
  expect(screen).not.toContain("function NewThreadSheet");
  expect(ownerConversationEmptyState).toContain('testID="new-chat-empty-state"');
  expect(ownerConversationEmptyState).toContain("What would you like to work on?");
  expect(conversationOverlay).toContain("<ProjectPickerSheet");
  expect(projectPickerContent).toContain("<LegendList");
  expect(projectPickerContent).toContain("recycleItems");
  expect(projectPickerRows).toContain('id: "section:recent"');
  expect(projectPickerRows).toContain('id: "section:other"');
  expect(projectPicker).not.toContain("<Accordion");
  expect(projectPickerHeader).toContain('accessibilityLabel="Add project"');
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
