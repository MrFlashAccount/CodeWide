import { readFileSync } from "node:fs";

export const ownerConversationPresentation = readFileSync(
  new URL("../../src/features/conversation/conversationPresentation.ts", import.meta.url),
  "utf8",
);
export const ownerConversationWorkspace = readFileSync(
  new URL("../../src/features/conversation/ConversationWorkspace.tsx", import.meta.url),
  "utf8",
);
export const ownerConversationEmptyState = readFileSync(
  new URL("../../src/features/conversation/ConversationEmptyState.tsx", import.meta.url),
  "utf8",
);
export const ownerConversationLayout = readFileSync(
  new URL("../../src/features/conversation/ConversationLayout.tsx", import.meta.url),
  "utf8",
);
export const ownerConversationHistoryStatus = readFileSync(
  new URL("../../src/features/conversation/ConversationHistoryStatus.tsx", import.meta.url),
  "utf8",
);
export const ownerConversationDetail = readFileSync(
  new URL("../../src/features/conversation/ConversationDetail.tsx", import.meta.url),
  "utf8",
);
export const ownerConversationTools = readFileSync(
  new URL("../../src/features/conversation/ConversationTools.tsx", import.meta.url),
  "utf8",
);
export const conversationOverlay = readFileSync(
  new URL("../../src/features/conversation/ConversationOverlayContent.tsx", import.meta.url),
  "utf8",
);
export const conversationLayout = readFileSync(
  new URL("../../src/features/conversation/ConversationLayout.tsx", import.meta.url),
  "utf8",
);
export const conversationLayoutStyles = readFileSync(
  new URL("../../src/features/conversation/ConversationLayout.styles.ts", import.meta.url),
  "utf8",
);
export const conversationAdapter = readFileSync(
  new URL("../../src/features/conversation/workspaceAdapter.ts", import.meta.url),
  "utf8",
);
export const ownerConversationWorkspaceContent = readFileSync(
  new URL("../../src/features/conversation/ConversationWorkspaceContent.tsx", import.meta.url),
  "utf8",
);
export const ownerConversationScopeBindings = readFileSync(
  new URL("../../src/features/conversation/conversationScopeBindings.ts", import.meta.url),
  "utf8",
);
