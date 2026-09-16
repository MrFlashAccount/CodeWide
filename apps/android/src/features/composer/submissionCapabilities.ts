import type { SendMode, TurnSendOptions } from "../../data/thread-delivery-state";
import type { StoredDraftAttachment } from "../../data/thread-ui-state-types";
import type { ConversationOwner } from "../../ui/use-conversation-owner";
import type { QueuedComposerEdit } from "./composerTypes";
import type { useComposerDraftCommands, useComposerDraftState } from "./draft";
import type { useComposerSettings } from "./settings";

type Draft = ReturnType<typeof useComposerDraftState>;
type Settings = ReturnType<typeof useComposerSettings>;
/** Submission retains the original draft and admission owner through asynchronous settlement. */
export type ComposerSubmissionCapabilities = Pick<
  Draft,
  | "composerUploadScope"
  | "latestAttachmentsRef"
  | "latestDraftRef"
  | "latestComposerPreferencesRef"
  | "composerMarkdownRef"
> &
  Pick<
    Settings,
    | "selectedModel"
    | "selectedEffort"
    | "selectedPersonality"
    | "selectedPermissions"
    | "capturePreferenceUpdate"
    | "captureControlsResource"
  > & {
    captureDraftMutations: ReturnType<typeof useComposerDraftCommands>["captureDraftMutations"];
    clearContentReviewAttachmentId: (scope: string, attachmentId: string) => void;
    composerScope: string;
    contentReviewAttachmentId: string | null;
    conversationOwner: ConversationOwner;
    currentTurnId: string | null;
    draftConnectionId: string | null;
    draftThreadId: string | null;
    onListQueue: (() => Promise<unknown>) | undefined;
    onSend:
      | ((text: string, mode: SendMode, options: TurnSendOptions) => Promise<string>)
      | undefined;
    pastedAttachmentPendingRef: { current: boolean };
    queuedComposerEdit: QueuedComposerEdit | null;
    saveDraft:
      | ((connectionId: string, threadId: string, text: string) => Promise<void>)
      | undefined;
    saveDraftAttachments:
      | ((
          connectionId: string,
          threadId: string,
          attachments: StoredDraftAttachment[],
        ) => Promise<void>)
      | undefined;
    threadLifecycleActive: boolean;
  };
