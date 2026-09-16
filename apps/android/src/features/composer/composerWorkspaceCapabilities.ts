import type { SendMode, TurnSendOptions } from "../../data/thread-delivery-state";
import type { StoredComposerPreferences } from "../../data/thread-ui-state-types";
import type { StoredDraftAttachment } from "../../data/thread-ui-state-types";
import type { ThreadSettings, TurnControlsValue } from "../../data/turn-controls-types";
import type { VoiceInputController } from "../../data/voice-input-controller";
import type {
  VoiceTranscriptionEvent,
  VoiceTranscriptionOptions,
  VoiceTranscriptionSession,
} from "../../data/voice-input-controller";
import type { WorkspaceResourceDatabase } from "../../data/workspace-resource-database";
/** Qualified capabilities consumed by the composer owner in conversation composition. */
export type ComposerWorkspaceCapabilities = {
  controlsResourceId: string | null;
  loadDraft: ((connectionId: string, threadId: string) => Promise<string>) | undefined;
  onInterrupt: ((turnId: string) => Promise<void>) | undefined;
  onLoadControls: ((cwd: string) => Promise<TurnControlsValue>) | undefined;
  onRetryFailedMessage: ((commandId: string) => Promise<void>) | undefined;
  onSend: ((text: string, mode: SendMode, options: TurnSendOptions) => Promise<string>) | undefined;
  onStartVoiceTranscription:
    | ((
        listener: (event: VoiceTranscriptionEvent) => void,
        options?: VoiceTranscriptionOptions,
      ) => Promise<VoiceTranscriptionSession>)
    | undefined;
  onUpdateSettings: ((settings: ThreadSettings) => Promise<void>) | undefined;
  removeDraftAttachment:
    | ((connectionId: string, threadId: string, attachmentId: string) => Promise<void>)
    | undefined;
  saveComposerPreferences:
    | ((
        connectionId: string,
        threadId: string,
        preferences: StoredComposerPreferences,
      ) => Promise<void>)
    | undefined;
  saveDraft: ((connectionId: string, threadId: string, text: string) => Promise<void>) | undefined;
  saveDraftAttachments:
    | ((
        connectionId: string,
        threadId: string,
        attachments: StoredDraftAttachment[],
      ) => Promise<void>)
    | undefined;
  upsertDraftAttachment:
    | ((
        connectionId: string,
        threadId: string,
        attachment: StoredDraftAttachment,
        isCurrent: () => boolean,
      ) => Promise<void>)
    | undefined;
  voiceController: VoiceInputController | null;
  workspaceResources: WorkspaceResourceDatabase | null;
};
