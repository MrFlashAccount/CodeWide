import { type AppVoiceInputRuntime } from "../../ui/VoiceInputRuntime";
import type { ConversationAgentCapabilities } from "../agents/conversationAgentCapabilities";
import type { ConversationAttachmentCapabilities } from "../attachments/conversationAttachmentCapabilities";
import { useDocumentTransferAccess } from "../attachments/documentNavigation";
import {
  useChangeResourcePresentation,
  useChangesPreferences,
} from "../changes/changePresentation";
import type { ConversationChangeCapabilities } from "../changes/conversationChangeCapabilities";
import { useComposerCommands } from "../composer/composerCommands";
import { useComposerState } from "../composer/composerState";
import type { ComposerWorkspaceCapabilities } from "../composer/composerWorkspaceCapabilities";
import type { ConversationDiagnosticCapabilities } from "../diagnostics/conversationDiagnosticCapabilities";
import type { ConversationPortCapabilities } from "../ports/conversationPortCapabilities";
import type { ThreadConversationCapabilities } from "../turnActions/threadConversationCapabilities";
import type { ConversationSurfaceCapabilities } from "./conversationSurfaceCapabilities";
import type { MainThreadReadCapabilities } from "./mainThreadReadCapabilities";
import { useOverlayScrollOwnership } from "./timeline/overlayScrollOwnership";
import { useThreadTimelineActions } from "./timeline/ThreadTimeline";

/** Inputs owned by this composition boundary; concrete state owners remain separate. */
export type UseConversationToolsProps = {
  composerScope: string;
  subagentSummaryDatabase: Exclude<
    ConversationAgentCapabilities["subagentSummaryDatabase"],
    undefined
  >;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  surfaceInputs: ConversationSurfaceCapabilities;
  subagentThreadDetails: Exclude<ConversationAgentCapabilities["subagentThreadDetails"], undefined>;
  agentsInputs: ConversationAgentCapabilities;
  changesInputs: ConversationChangeCapabilities;
  attachmentsInputs: ConversationAttachmentCapabilities;
  diagnosticsInputs: ConversationDiagnosticCapabilities;
  threadTimelineActionsBinding: ReturnType<typeof useThreadTimelineActions>;
  readInputs: MainThreadReadCapabilities;
  overlayScrollOwnershipBinding: ReturnType<typeof useOverlayScrollOwnership>;
  cwd: Exclude<ConversationSurfaceCapabilities["cwd"], undefined>;
  actionsInputs: ThreadConversationCapabilities;
  composerCommands: ReturnType<typeof useComposerCommands>;
  fileTransferController: Exclude<
    ConversationAttachmentCapabilities["fileTransferController"],
    undefined
  >;
  composerStateBinding: ReturnType<typeof useComposerState>;
  appVoiceInputRuntime: AppVoiceInputRuntime;
  voiceController: Exclude<ComposerWorkspaceCapabilities["voiceController"], undefined>;
  composerInputs: ComposerWorkspaceCapabilities;
  changesPreferencesBinding: ReturnType<typeof useChangesPreferences>;
  getStableTransferAccess: ReturnType<typeof useDocumentTransferAccess>;
  changeResourcePresentationBinding: ReturnType<typeof useChangeResourcePresentation>;
  portsInputs: ConversationPortCapabilities;
  threadResourcesModel: Exclude<ConversationChangeCapabilities["threadResourcesModel"], undefined>;
  threadResourceId: Exclude<ConversationChangeCapabilities["threadResourceId"], undefined>;
  threadResourceRevision: Exclude<
    ConversationChangeCapabilities["threadResourceRevision"],
    undefined
  >;
  portForwardingConnectionId: Exclude<
    ConversationPortCapabilities["portForwardingConnectionId"],
    undefined
  >;
};
