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
    composerScope: string;
    queuedComposerEdit: QueuedComposerEdit | null;
    pastedAttachmentPendingRef: { current: boolean };
    captureDraftMutations: ReturnType<typeof useComposerDraftCommands>["captureDraftMutations"];
    threadLifecycleActive: boolean;
    currentTurnId: string | null;
    contentReviewAttachmentId: string | null;
    clearContentReviewAttachmentId(scope: string, attachmentId: string): void;
    conversationOwner: ConversationOwner;
    draftConnectionId: string | null;
    draftThreadId: string | null;
    onSend:
      | ((text: string, mode: SendMode, options: TurnSendOptions) => Promise<string>)
      | undefined;
    onListQueue: (() => Promise<unknown>) | undefined;
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
  };
