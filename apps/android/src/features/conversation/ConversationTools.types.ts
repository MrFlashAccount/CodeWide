import type { AppVoiceInputRuntime } from "../../ui/VoiceInputRuntime";
import type { ConversationAgentCapabilities } from "../agents/conversationAgentCapabilities";
import type { ConversationAttachmentCapabilities } from "../attachments/conversationAttachmentCapabilities";
import type { useDocumentTransferAccess } from "../attachments/documentNavigation";
import type {
  useChangeResourcePresentation,
  useChangesPreferences,
} from "../changes/changePresentation";
import type { ConversationChangeCapabilities } from "../changes/conversationChangeCapabilities";
import type { useComposerCommands } from "../composer/composerCommands";
import type { useComposerState } from "../composer/composerState";
import type { ComposerWorkspaceCapabilities } from "../composer/composerWorkspaceCapabilities";
import type { ConversationDiagnosticCapabilities } from "../diagnostics/conversationDiagnosticCapabilities";
import type { ConversationPortCapabilities } from "../ports/conversationPortCapabilities";
import type { ThreadConversationCapabilities } from "../turnActions/threadConversationCapabilities";
import type { ConversationSurfaceCapabilities } from "./conversationSurfaceCapabilities";
import type { MainThreadReadCapabilities } from "./mainThreadReadCapabilities";
import type { useOverlayScrollOwnership } from "./timeline/overlayScrollOwnership";
import type { useThreadTimelineActions } from "./timeline/ThreadTimeline";

/** Inputs owned by this composition boundary; concrete state owners remain separate. */
export type UseConversationToolsProps = {
  actionsInputs: ThreadConversationCapabilities;
  agentsInputs: ConversationAgentCapabilities;
  appVoiceInputRuntime: AppVoiceInputRuntime;
  attachmentsInputs: ConversationAttachmentCapabilities;
  changeResourcePresentationBinding: ReturnType<typeof useChangeResourcePresentation>;
  changesInputs: ConversationChangeCapabilities;
  changesPreferencesBinding: ReturnType<typeof useChangesPreferences>;
  composerCommands: ReturnType<typeof useComposerCommands>;
  composerInputs: ComposerWorkspaceCapabilities;
  composerScope: string;
  composerStateBinding: ReturnType<typeof useComposerState>;
  cwd: Exclude<ConversationSurfaceCapabilities["cwd"], undefined>;
  diagnosticsInputs: ConversationDiagnosticCapabilities;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  fileTransferController: Exclude<
    ConversationAttachmentCapabilities["fileTransferController"],
    undefined
  >;
  getStableTransferAccess: ReturnType<typeof useDocumentTransferAccess>;
  overlayScrollOwnershipBinding: ReturnType<typeof useOverlayScrollOwnership>;
  portForwardingConnectionId: Exclude<
    ConversationPortCapabilities["portForwardingConnectionId"],
    undefined
  >;
  portsInputs: ConversationPortCapabilities;
  readInputs: MainThreadReadCapabilities;
  subagentSummaryDatabase: Exclude<
    ConversationAgentCapabilities["subagentSummaryDatabase"],
    undefined
  >;
  subagentThreadDetails: Exclude<ConversationAgentCapabilities["subagentThreadDetails"], undefined>;
  surfaceInputs: ConversationSurfaceCapabilities;
  threadResourceId: Exclude<ConversationChangeCapabilities["threadResourceId"], undefined>;
  threadResourceRevision: Exclude<
    ConversationChangeCapabilities["threadResourceRevision"],
    undefined
  >;
  threadResourcesModel: Exclude<ConversationChangeCapabilities["threadResourcesModel"], undefined>;
  threadTimelineActionsBinding: ReturnType<typeof useThreadTimelineActions>;
  voiceController: Exclude<ComposerWorkspaceCapabilities["voiceController"], undefined>;
};
