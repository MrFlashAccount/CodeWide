import type { SendMode, TurnSendOptions } from "../../data/thread-delivery-state";
import type {
  StoredComposerPreferences,
  StoredDraftAttachment,
} from "../../data/thread-ui-state-types";
import type { ThreadSettings } from "../../data/turn-controls-types";
import type {
  VoiceTranscriptionOptions,
  VoiceTranscriptionSession,
} from "../../data/voice-input-controller";
import type { VoiceTranscriptionListener } from "../../data/voice-transport";
import type { TurnControlsValue } from "../../data/workspace-resource-database";
/** Qualified composer operations; transport and persisted state stay with their existing lower owners. */
export type ComposerWorkspaceCapabilities = {
  loadDraft(connectionId: string, threadId: string): Promise<string>;
  saveDraft(connectionId: string, threadId: string, text: string): Promise<void>;
  loadDraftAttachments(connectionId: string, threadId: string): Promise<StoredDraftAttachment[]>;
  saveDraftAttachments(
    connectionId: string,
    threadId: string,
    attachments: StoredDraftAttachment[],
  ): Promise<void>;
  upsertDraftAttachment(
    connectionId: string,
    threadId: string,
    attachment: StoredDraftAttachment,
    isCurrent: () => boolean,
  ): Promise<void>;
  removeDraftAttachment(
    connectionId: string,
    threadId: string,
    attachmentId: string,
  ): Promise<void>;
  loadComposerPreferences(
    connectionId: string,
    threadId: string,
  ): Promise<StoredComposerPreferences | null>;
  saveComposerPreferences(
    connectionId: string,
    threadId: string,
    preferences: StoredComposerPreferences,
  ): Promise<void>;
  updateThreadSettings(
    connectionId: string,
    threadId: string,
    settings: ThreadSettings,
  ): Promise<void>;
  sendText(
    connectionId: string,
    threadId: string,
    text: string,
    mode?: SendMode,
    options?: TurnSendOptions,
  ): Promise<string>;
  retryFailedMessage(connectionId: string, commandId: string): Promise<void>;
  loadTurnControls(connectionId: string, cwd: string): Promise<TurnControlsValue>;
  startVoiceTranscription(
    connectionId: string,
    threadId: string,
    listener: VoiceTranscriptionListener,
    options?: VoiceTranscriptionOptions,
  ): Promise<VoiceTranscriptionSession>;
};
