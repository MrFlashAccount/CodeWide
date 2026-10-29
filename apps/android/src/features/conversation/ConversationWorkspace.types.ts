import type { RenderBlock } from "@codewide/renderers";
import type { ReactNode } from "react";
import type { StoredConnection } from "../../data/connection-profile-types";
import type { FileTransferController } from "../../data/file-transfer-controller";
import type { PendingServerRequest } from "../../data/pending-request-types";
import type { SendMode, TurnSendOptions } from "../../data/thread-delivery-state";
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
import type { NewChatProjectPickerBinding } from "../projects/NewChatProjectPicker";
import type { SearchConversationWindow } from "../search/search-conversation-window";
import type { ThreadListItem } from "../threadList/threadListTypes";
import type { ConversationWorkspaceFeatures } from "./conversationWorkspaceFeatures";
import type { ConversationHostPresentation } from "./header/ConversationHeaderContract";

/** Sends a draft's first message and settles with the composer command id. */
export type DraftSubmission = (
  text: string,
  mode: SendMode,
  options: TurnSendOptions,
) => Promise<string>;

/**
 * The shared new chat creates its thread on the first send, with the server default as its
 * project. A hosted draft (a PR review chat) belongs to its host: the host admits the first
 * message, restricts and suggests projects in explicit-choice mode, and offers no server
 * default, so `send` is `null` until a project is chosen.
 */
export type DraftAdmission =
  | {
      readonly kind: "newChat";
      /** Reveals the created chat; the owner skips it after the user opened another chat. */
      readonly openAdmittedThread: (selectionKey: string) => void;
    }
  | {
      readonly kind: "hosted";
      /** Shown under the draft's project control, such as a scenario waiting to start. */
      readonly notice: ReactNode;
      readonly picker: NewChatProjectPickerBinding;
      readonly send: DraftSubmission | null;
      /** The host is still finding the project to pre-select. */
      readonly suggesting: boolean;
    };

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
        /** Who admits the draft's first message and owns its project choice. */
        readonly admission: DraftAdmission;
        readonly draft: NewThreadDraft;
        readonly kind: "draft";
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
  /** How the host places the conversation; an ordinary thread screen when absent. */
  presentation?: ConversationHostPresentation;
  runtime: Pick<
    WorkspaceRuntimeSnapshot,
    "threadDetails" | "threadSummaries" | "threadUiState" | "resources" | "accountRateLimits"
  >;
  scopedThreads: readonly ThreadListItem[];
  servers: ThreadListServer[];
  voiceController: VoiceInputController | null;
};
