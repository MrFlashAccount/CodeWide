import type { StoredDraftAttachment } from "../../data/thread-ui-state-types";
import type { VoiceInputRow } from "../../data/workspace-resource-database";
import type { QueuedComposerEdit } from "./composerTypes";
import type { ComposerSendPreference } from "./deliveryMode";
/** Primary and alternate activation dispatch only to their existing command owners. */
export type ComposerDeliveryCapabilities = {
  attachments: StoredDraftAttachment[];
  cancelQueuedComposerEdit: () => void;
  clearComposerText: () => void;
  currentTurnId: string | null;
  discardVoice: () => Promise<void>;
  draft: string;
  finishVoice: (sendAfter: boolean, preference?: ComposerSendPreference) => Promise<void>;
  goalSubmissionActive: boolean;
  onEditQueued:
    | ((commandId: string, text: string, attachments: StoredDraftAttachment[]) => Promise<void>)
    | undefined;
  onInterrupt: ((turnId: string) => Promise<void>) | undefined;
  pastedAttachmentPending: boolean;
  queuedComposerEdit: QueuedComposerEdit | null;
  queuedComposerEditBusy: boolean;
  saveQueuedComposerEdit: () => void;
  send: (textOverride?: string, preference?: ComposerSendPreference) => Promise<void>;
  threadLifecycleActive: boolean;
  uploadsBlockSend: boolean;
  voiceError: string | null;
  voicePhase: VoiceInputRow["phase"];
  voiceRetryAvailable: boolean;
};
