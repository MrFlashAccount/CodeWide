import type { RenderBlock } from "@codewide/renderers";
import type { StoredConnection } from "../../data/connection-profile-types";
import type { FileTransferController } from "../../data/file-transfer-controller";
import type { PendingServerRequest } from "../../data/pending-request-types";
import type { VoiceInputController } from "../../data/voice-input-controller";
import type { NewChatWorkspaceMode } from "../../data/workspace-creation";
import type { WorkspaceRuntimeSnapshot } from "../../data/workspace-runtime";
import type { NewThreadDraft } from "../../services/threads/newThreadService";
import type { useTurnChangesLoader } from "../changes/turnChanges";
import type { ThreadListServer } from "../connections/connectionPresentation";
import type { useLoopbackNavigation } from "../ports/loopbackNavigation";
import type { useActiveProjectSelection } from "../projects/activeProjectSelection";
import type { ThreadListItem } from "../threadList/threadListTypes";
import type { useActiveThreadActions, useThreadMutationActions } from "../turnActions/turnActions";
import type { ConversationDetailSnapshot } from "./conversationCapabilities";
import type { createConversationScopeBindings } from "./conversationScopeBindings";
import type { ConversationWorkspaceFeatures } from "./conversationWorkspaceFeatures";

/** Inputs owned by this composition boundary; concrete state owners remain separate. */
export type RenderConversationWorkspaceContentProps = {
  activeConnectionId: string;
  activeConnectionState: StoredConnection["state"];
  activeControlsResourceId: string | null;
  activeDiscoveredProjects: ReturnType<
    typeof useActiveProjectSelection
  >["activeDiscoveredProjects"];
  activePendingRequests: PendingServerRequest[];
  activeProjectError: ReturnType<typeof useActiveProjectSelection>["activeProjectError"];
  activeProjects: ReturnType<typeof useActiveProjectSelection>["activeProjects"];
  activeThread: ThreadListItem | null;
  activeThreadResourceId: string | null;
  activeTunnelResourceId: string | null;
  activeWorkspaceSupport: ReturnType<typeof useActiveProjectSelection>["activeWorkspaceSupport"];
  addActiveProject: ReturnType<typeof useActiveProjectSelection>["addActiveProject"];
  changeEmptyThreadProject: ReturnType<
    typeof useActiveProjectSelection
  >["changeEmptyThreadProject"];
  closeActiveConversation: () => void;
  conversationActions: ReturnType<typeof createConversationScopeBindings>;
  desktop: boolean;
  features: Pick<
    ConversationWorkspaceFeatures,
    "composer" | "conversation" | "accounts" | "agents"
  >;
  fileTransferController: FileTransferController | null;
  forkCurrentThread: ReturnType<typeof useActiveThreadActions>["forkCurrentThread"];
  loadTurnChanges: ReturnType<typeof useTurnChangesLoader>["loadTurnChanges"];
  markActiveThreadRead: ReturnType<typeof useActiveThreadActions>["markActiveThreadRead"];
  native: boolean;
  newChatDraft: NewThreadDraft | null;
  onChangeDraftWorkspaceMode: (draftId: string, mode: NewChatWorkspaceMode) => void;
  onFixUnsupportedBlock: (block: RenderBlock) => Promise<void>;
  onManageProjects: () => void;
  onOpenBrowser: (title: string, url: string) => void;
  openActiveLoopbackLink: ReturnType<typeof useLoopbackNavigation>;
  readActiveDirectory: ReturnType<typeof useActiveProjectSelection>["readActiveDirectory"];
  runtime: Pick<WorkspaceRuntimeSnapshot, "threadDetails" | "resources" | "accountRateLimits">;
  servers: ThreadListServer[];
  snapshot: ConversationDetailSnapshot;
  threadMutationActions: ReturnType<typeof useThreadMutationActions>;
  visibleConversationThread: ThreadListItem | null;
  voiceController: VoiceInputController | null;
};
