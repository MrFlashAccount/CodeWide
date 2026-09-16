import type { Dispatch, SetStateAction } from "react";
import type { QueuedPrompt } from "../../data/thread-delivery-state";
import type { StoredDraftAttachment } from "../../data/thread-ui-state-types";
import type { VoiceInputRow } from "../../data/workspace-resource-database";
import type { ConversationOwner } from "../../ui/use-conversation-owner";
import type { useComposerDraftState } from "./draft";
import type { QueuedComposerEdit } from "./composerTypes";
/** The queue editor mutates its own upload scope and captured activation only. */
export type QueueEditCapabilities = Pick<
  ReturnType<typeof useComposerDraftState>,
  | "composerUploadScope"
  | "draftSelectionRef"
  | "composerInputRef"
  | "composerMarkdownRef"
  | "latestAttachmentsRef"
  | "uploadsBlockSend"
> & {
  closeInlineQueueOverlay: () => void;
  conversationOwner: ConversationOwner;
  onEditQueued:
    | ((commandId: string, text: string, attachments: StoredDraftAttachment[]) => Promise<void>)
    | undefined;
  onListQueue: (() => Promise<QueuedPrompt[]>) | undefined;
  queuedComposerEdit: QueuedComposerEdit | null;
  queuedComposerEditBusy: boolean;
  setQueuedComposerEdit: Dispatch<SetStateAction<QueuedComposerEdit | null>>;
  setQueuedComposerEditBusy: Dispatch<SetStateAction<boolean>>;
  setQueuedComposerEditError: Dispatch<SetStateAction<string | null>>;
  voicePhase: VoiceInputRow["phase"];
};
