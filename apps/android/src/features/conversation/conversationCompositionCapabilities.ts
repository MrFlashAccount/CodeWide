import type { ConversationAccountCapabilities } from "../accounts/conversationAccountCapabilities";
import type { ConversationAgentCapabilities } from "../agents/conversationAgentCapabilities";
import type { ConversationAttachmentCapabilities } from "../attachments/conversationAttachmentCapabilities";
import type { ConversationChangeCapabilities } from "../changes/conversationChangeCapabilities";
import type { ComposerWorkspaceCapabilities } from "../composer/composerWorkspaceCapabilities";
import type { ConversationDiagnosticCapabilities } from "../diagnostics/conversationDiagnosticCapabilities";
import type { ConversationGoalCapabilities } from "../goal/conversationGoalCapabilities";
import type { ConversationPortCapabilities } from "../ports/conversationPortCapabilities";
import type { ProjectConversationCapabilities } from "../projects/projectConversationCapabilities";
import type { QueueWorkspaceCapabilities } from "../queue/queueWorkspaceCapabilities";
import type { ConversationRequestCapabilities } from "../requests/conversationRequestCapabilities";
import type { ConversationReviewCapabilities } from "../review/conversationReviewCapabilities";
import type { ConversationTerminalCapabilities } from "../terminal/conversationTerminalCapabilities";
import type { ThreadConversationCapabilities } from "../turnActions/threadConversationCapabilities";
import type { ConversationSurfaceCapabilities } from "./conversationSurfaceCapabilities";
import type { MainThreadReadCapabilities } from "./mainThreadReadCapabilities";

/** Composition connects independently-owned feature input and command contracts. */
export type ConversationCompositionCapabilities = {
  accounts: ConversationAccountCapabilities;
  actions: ThreadConversationCapabilities;
  agents: ConversationAgentCapabilities;
  attachments: ConversationAttachmentCapabilities;
  changes: ConversationChangeCapabilities;
  composer: ComposerWorkspaceCapabilities;
  diagnostics: ConversationDiagnosticCapabilities;
  goal: ConversationGoalCapabilities;
  ports: ConversationPortCapabilities;
  projects: ProjectConversationCapabilities;
  queue: QueueWorkspaceCapabilities;
  read: MainThreadReadCapabilities;
  requests: ConversationRequestCapabilities;
  review: ConversationReviewCapabilities;
  surface: ConversationSurfaceCapabilities;
  terminal: ConversationTerminalCapabilities;
};
