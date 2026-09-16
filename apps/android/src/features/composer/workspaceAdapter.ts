import { randomUUID } from "expo-crypto";
import type { ThreadUiStateDatabase } from "../../data/thread-ui-state-database";
import { getOrCreateThreadUiState } from "../../data/thread-ui-state-initialization";
import type {
  StoredComposerPreferences,
  StoredDraftAttachment,
} from "../../data/thread-ui-state-types";
import type { ThreadSettings } from "../../data/turn-controls-types";
import type { TurnControlsValue } from "../../data/workspace-resource-database";
import { enqueueNativeCommand } from "../../native/native-transport";

import type { ComposerWorkspaceCapabilities } from "./workspaceCapabilities";
/** Converts composer intents using retained lower authorities. */
export function createComposerWorkspaceAdapter({
  getThreadUiState,
  loadTurnControls,
  retryFailedMessage,
  sendText,
  startVoiceTranscription,
}: {
  getThreadUiState: () => ThreadUiStateDatabase | null;
  loadTurnControls: (connectionId: string, cwd: string) => Promise<TurnControlsValue>;
  retryFailedMessage: ComposerWorkspaceCapabilities["retryFailedMessage"];
  sendText: ComposerWorkspaceCapabilities["sendText"];
  startVoiceTranscription: ComposerWorkspaceCapabilities["startVoiceTranscription"];
}): ComposerWorkspaceCapabilities {
  const loadDraft = async (connectionId: string, threadId: string): Promise<string> =>
    (await getOrCreateThreadUiState(connectionId, threadId, getThreadUiState())).draftText;

  const saveDraft = async (connectionId: string, threadId: string, text: string): Promise<void> => {
    await requireThreadUiStateDatabase(getThreadUiState()).saveDraft(connectionId, threadId, text);
  };

  const loadDraftAttachments = async (
    connectionId: string,
    threadId: string,
  ): Promise<StoredDraftAttachment[]> =>
    (await getOrCreateThreadUiState(connectionId, threadId, getThreadUiState())).attachments;

  const saveDraftAttachments = async (
    connectionId: string,
    threadId: string,
    attachments: StoredDraftAttachment[],
  ): Promise<void> => {
    await requireThreadUiStateDatabase(getThreadUiState()).saveAttachments(
      connectionId,
      threadId,
      attachments,
    );
  };

  const upsertDraftAttachment = async (
    connectionId: string,
    threadId: string,
    attachment: StoredDraftAttachment,
    isCurrent: () => boolean,
  ): Promise<void> => {
    await requireThreadUiStateDatabase(getThreadUiState()).upsertAttachment(
      connectionId,
      threadId,
      attachment,
      isCurrent,
    );
  };

  const removeDraftAttachment = async (
    connectionId: string,
    threadId: string,
    attachmentId: string,
  ): Promise<void> => {
    await requireThreadUiStateDatabase(getThreadUiState()).removeAttachment(
      connectionId,
      threadId,
      attachmentId,
    );
  };

  const loadComposerPreferences = async (connectionId: string, threadId: string) =>
    (await getOrCreateThreadUiState(connectionId, threadId, getThreadUiState())).preferences;

  const saveComposerPreferences = async (
    connectionId: string,
    threadId: string,
    preferences: StoredComposerPreferences,
  ) => {
    await requireThreadUiStateDatabase(getThreadUiState()).savePreferences(
      connectionId,
      threadId,
      preferences,
    );
  };

  const updateThreadSettings = async (
    connectionId: string,
    threadId: string,
    settings: ThreadSettings,
  ) => {
    await enqueueNativeCommand(
      connectionId,
      `thread-settings-${randomUUID()}`,
      "thread/settings/update",
      { threadId, ...settings },
    );
  };
  return {
    loadComposerPreferences,
    loadDraft,
    loadDraftAttachments,
    loadTurnControls,
    removeDraftAttachment,
    retryFailedMessage,
    saveComposerPreferences,
    saveDraft,
    saveDraftAttachments,
    sendText,
    startVoiceTranscription,
    updateThreadSettings,
    upsertDraftAttachment,
  };
}
function requireThreadUiStateDatabase(
  database: ThreadUiStateDatabase | null,
): ThreadUiStateDatabase {
  if (database === null) {
    throw new Error("Local thread UI state is not ready");
  }
  return database;
}
