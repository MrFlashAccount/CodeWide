import type { StoredDraftAttachment } from "../../data/thread-ui-state-types";
import type { VoiceInputRow } from "../../data/workspace-resource-database";
import type { QueuedComposerEdit } from "./composerTypes";
import type { ComposerSendPreference } from "./deliveryMode";
/** Primary and alternate activation dispatch only to their existing command owners. */
export type ComposerDeliveryCapabilities = {
  queuedComposerEdit: QueuedComposerEdit | null;
  queuedComposerEditBusy: boolean;
  voicePhase: VoiceInputRow["phase"];
  finishVoice(sendAfter: boolean, preference?: ComposerSendPreference): Promise<void>;
  send(textOverride?: string, preference?: ComposerSendPreference): void;
  currentTurnId: string | null;
  draft: string;
  attachments: StoredDraftAttachment[];
  onEditQueued:
    | ((commandId: string, text: string, attachments: StoredDraftAttachment[]) => Promise<void>)
    | undefined;
  pastedAttachmentPending: boolean;
  uploadsBlockSend: boolean;
  voiceRetryAvailable: boolean;
  voiceError: string | null;
  cancelQueuedComposerEdit(): void;
  discardVoice(): Promise<void>;
  clearComposerText(): void;
  saveQueuedComposerEdit(): void;
  onInterrupt: ((turnId: string) => Promise<void>) | undefined;
  threadLifecycleActive: boolean;
};
