import type { RenderBlock } from "@codewide/renderers";
import type { StoredConnection } from "../../data/connection-profile-types";
import type { FileTransferController } from "../../data/file-transfer-controller";
import type { PendingServerRequest } from "../../data/pending-request-types";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import type { VoiceInputController } from "../../data/voice-input-controller";
import type { NewChatWorkspaceMode } from "../../data/workspace-creation";
import type { WorkspaceRuntimeSnapshot } from "../../data/workspace-runtime";
import type { NewThreadDraft } from "../../services/threads/newThreadService";
import type {
  V1ThreadRouteParams,
  SelectWorkspaceThread,
} from "../../services/threads/threadRouteParams";
import type { ThreadListServer } from "../connections/connectionPresentation";
import type { SearchConversationWindow } from "../search/search-conversation-window";
import type { ThreadListItem } from "../threadList/threadListTypes";
import type { ConversationWorkspaceFeatures } from "./conversationWorkspaceFeatures";

/** Inputs owned by this composition boundary; concrete state owners remain separate. */
export type ActiveWorkspaceConversationProps = {
  connections: StoredConnection[];
  desktop: boolean;
  destination:
    | {
        readonly connectionId: string;
        readonly kind: "thread";
        readonly searchWindow: SearchConversationWindow | null;
        readonly threadId: string;
      }
    | {
        readonly draft: NewThreadDraft;
        readonly kind: "draft";
        /** Reveals the created chat; the owner skips it after the user opened another chat. */
        readonly openAdmittedThread: (selectionKey: string) => void;
      };
  features: ConversationWorkspaceFeatures;
  fileTransferController: FileTransferController | null;
  loadedThreadSummaries: StoredThreadSummary[];
  native: boolean;
  onChangeDraftProject: (draftId: string, cwd: string | null) => void;
  onChangeDraftWorkspaceMode: (draftId: string, mode: NewChatWorkspaceMode) => void;
  onClose: () => void;
  onDraftAdmitted: (draftId: string) => void;
  onExitSearchHistory: () => void;
  onFixUnsupportedBlock: (block: RenderBlock) => Promise<void>;
  onManageProjects: () => void;
  onOpenBrowser: (title: string, url: string) => void;
  onOpenBrowserInThread?: (title: string, url: string, thread: V1ThreadRouteParams | null) => void;
  onSelectThread: SelectWorkspaceThread;
  onShowActiveThreads: () => void;
  pendingRequests: PendingServerRequest[];
  runtime: Pick<
    WorkspaceRuntimeSnapshot,
    "threadDetails" | "threadSummaries" | "threadUiState" | "resources" | "accountRateLimits"
  >;
  scopedThreads: readonly ThreadListItem[];
  servers: ThreadListServer[];
  voiceController: VoiceInputController | null;
};
