import { type RenderBlock } from "@codewide/renderers";
import type { StoredConnection } from "../../data/connection-profile-types";
import type { FileTransferController } from "../../data/file-transfer-controller";
import type { PendingServerRequest } from "../../data/pending-request-types";
import type { VoiceInputController } from "../../data/voice-input-controller";
import type { WorkspaceRuntimeSnapshot } from "../../data/workspace-runtime";
import { useTurnChangesLoader } from "../changes/turnChanges";
import { type ThreadListServer } from "../connections/connectionPresentation";
import type { NewChatDraft } from "../navigation/threadNavigation";
import { type ThreadNavigationModel } from "../navigation/threadNavigation";
import { useLoopbackNavigation } from "../ports/browserNavigation";
import { useActiveProjectSelection } from "../projects/activeProjectSelection";
import { type ThreadListItem } from "../threadList/threadListTypes";
import { useActiveThreadActions, useThreadMutationActions } from "../turnActions/turnActions";
import type { ConversationDetailSnapshot } from "./conversationCapabilities";
import { createConversationScopeBindings } from "./conversationScopeBindings";
import type { ConversationWorkspaceFeatures } from "./conversationWorkspaceFeatures";

/** Inputs owned by this composition boundary; concrete state owners remain separate. */
export type RenderConversationWorkspaceContentProps = {
  snapshot: ConversationDetailSnapshot;
  features: Pick<
    ConversationWorkspaceFeatures,
    "composer" | "conversation" | "accounts" | "agents"
  >;
  runtime: Pick<WorkspaceRuntimeSnapshot, "threadDetails" | "resources" | "accountRateLimits">;
  conversationActions: ReturnType<typeof createConversationScopeBindings>;
  activePendingRequests: PendingServerRequest[];
  visibleConversationThread: ThreadListItem | null;
  servers: ThreadListServer[];
  activeConnectionId: string;
  newChatDraft: NewChatDraft | null;
  desktop: boolean;
  closeActiveConversation: () => void;
  activeThread: ThreadListItem | null;
  markActiveThreadRead: ReturnType<typeof useActiveThreadActions>["markActiveThreadRead"];
  voiceController: VoiceInputController | null;
  activeControlsResourceId: string | null;
  threadNavigation: ThreadNavigationModel;
  onManageProjects: () => void;
  threadMutationActions: ReturnType<typeof useThreadMutationActions>;
  forkCurrentThread: ReturnType<typeof useActiveThreadActions>["forkCurrentThread"];
  loadTurnChanges: ReturnType<typeof useTurnChangesLoader>["loadTurnChanges"];
  activeThreadResourceId: string | null;
  activeConnectionState: StoredConnection["state"];
  fileTransferController: FileTransferController | null;
  activeTunnelResourceId: string | null;
  native: boolean;
  onOpenBrowser: (title: string, url: string) => void;
  openActiveLoopbackLink: ReturnType<typeof useLoopbackNavigation>;
  onFixUnsupportedBlock: (block: RenderBlock) => Promise<void>;
  activeProjects: ReturnType<typeof useActiveProjectSelection>["activeProjects"];
  activeDiscoveredProjects: ReturnType<
    typeof useActiveProjectSelection
  >["activeDiscoveredProjects"];
  activeProjectError: ReturnType<typeof useActiveProjectSelection>["activeProjectError"];
  changeEmptyThreadProject: ReturnType<
    typeof useActiveProjectSelection
  >["changeEmptyThreadProject"];
  activeWorkspaceSupport: ReturnType<typeof useActiveProjectSelection>["activeWorkspaceSupport"];
  addActiveProject: ReturnType<typeof useActiveProjectSelection>["addActiveProject"];
  readActiveDirectory: ReturnType<typeof useActiveProjectSelection>["readActiveDirectory"];
};
