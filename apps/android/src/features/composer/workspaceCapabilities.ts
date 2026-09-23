import type { SendMode, TurnSendOptions } from "../../data/thread-delivery-state";
import type {
  StoredComposerPreferences,
  StoredDraftAttachment,
} from "../../data/thread-ui-state-types";
import type {
  LoadTurnControls,
  ThreadSettings,
  TurnControlsLoadOptions,
} from "../../data/turn-controls-types";
import type {
  VoiceTranscriptionOptions,
  VoiceTranscriptionSession,
} from "../../data/voice-input-controller";
import type { VoiceTranscriptionListener } from "../../data/voice-transport";
/** Qualified composer operations; transport and persisted state stay with their existing lower owners. */
export type ComposerWorkspaceCapabilities = {
  loadComposerPreferences: (
    connectionId: string,
    threadId: string,
  ) => Promise<StoredComposerPreferences | null>;
  loadDraft: (connectionId: string, threadId: string) => Promise<string>;
  loadDraftAttachments: (
    connectionId: string,
    threadId: string,
  ) => Promise<StoredDraftAttachment[]>;
  loadTurnControls: (
    connectionId: string,
    cwd: string,
    options?: TurnControlsLoadOptions,
  ) => ReturnType<LoadTurnControls>;
  removeDraftAttachment: (
    connectionId: string,
    threadId: string,
    attachmentId: string,
  ) => Promise<void>;
  retryFailedMessage: (connectionId: string, commandId: string) => Promise<void>;
  saveComposerPreferences: (
    connectionId: string,
    threadId: string,
    preferences: StoredComposerPreferences,
  ) => Promise<void>;
  saveDraft: (connectionId: string, threadId: string, text: string) => Promise<void>;
  saveDraftAttachments: (
    connectionId: string,
    threadId: string,
    attachments: StoredDraftAttachment[],
  ) => Promise<void>;
  // WHY: This extracted V1 signature is shared by existing callers; changing its call shape would expand this behavior-preserving cleanup into an API migration.
  // oxlint-disable-next-line eslint/max-params
  sendText: (
    connectionId: string,
    threadId: string,
    text: string,
    mode?: SendMode,
    options?: TurnSendOptions,
  ) => Promise<string>;
  // WHY: This extracted V1 signature is shared by existing callers; changing its call shape would expand this behavior-preserving cleanup into an API migration.
  // oxlint-disable-next-line eslint/max-params
  startVoiceTranscription: (
    connectionId: string,
    threadId: string,
    listener: VoiceTranscriptionListener,
    options?: VoiceTranscriptionOptions,
  ) => Promise<VoiceTranscriptionSession>;
  updateThreadSettings: (
    connectionId: string,
    threadId: string,
    settings: ThreadSettings,
  ) => Promise<void>;
  // WHY: This extracted V1 signature is shared by existing callers; changing its call shape would expand this behavior-preserving cleanup into an API migration.
  // oxlint-disable-next-line eslint/max-params
  upsertDraftAttachment: (
    connectionId: string,
    threadId: string,
    attachment: StoredDraftAttachment,
    isCurrent: () => boolean,
  ) => Promise<void>;
};
