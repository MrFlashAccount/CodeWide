import { type RenderBlock } from "@codewide/renderers";
import type { StoredConnection } from "../../data/connection-profile-types";
import type { FileTransferController } from "../../data/file-transfer-controller";
import type { PendingServerRequest } from "../../data/pending-request-types";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import type { VoiceInputController } from "../../data/voice-input-controller";
import type { WorkspaceRuntimeSnapshot } from "../../data/workspace-runtime";
import { type ThreadListServer } from "../connections/connectionPresentation";
import {
  type ConversationDestination as ConversationNavigationDestination,
  type SelectWorkspaceThread,
  type ThreadNavigationModel,
} from "../navigation/threadNavigation";
import { type ThreadListItem } from "../threadList/threadListTypes";
import type { ConversationWorkspaceFeatures } from "./conversationWorkspaceFeatures";

/** Inputs owned by this composition boundary; concrete state owners remain separate. */
export type ActiveWorkspaceConversationProps = {
  destination: ConversationNavigationDestination;
  runtime: Pick<
    WorkspaceRuntimeSnapshot,
    "threadDetails" | "threadSummaries" | "threadUiState" | "resources" | "accountRateLimits"
  >;
  connections: StoredConnection[];
  pendingRequests: PendingServerRequest[];
  native: boolean;
  voiceController: VoiceInputController | null;
  fileTransferController: FileTransferController | null;
  features: ConversationWorkspaceFeatures;
  threadNavigation: ThreadNavigationModel;
  desktop: boolean;
  activeServerId: string;
  servers: ThreadListServer[];
  scopedThreads: readonly ThreadListItem[];
  loadedThreadSummaries: StoredThreadSummary[];
  defaultDesktopThreadId: string | null;
  onSelectThread: SelectWorkspaceThread;
  onOpenBrowser(title: string, url: string): void;
  onManageProjects(): void;
  onShowActiveThreads(): void;
  onFixUnsupportedBlock(block: RenderBlock): Promise<void>;
};
