/** V1 draft owner, extracted without changing interaction or resource lifetime. */
import type { StoredComposerPreferences } from "../../data/thread-ui-state-types";
import type { StoredDraftAttachment } from "../../data/thread-ui-state-types";

export const EMPTY_COMPOSER_PREFERENCES: StoredComposerPreferences = {
  effort: null,
  model: null,
  permissions: null,
  personality: null,
  sendMode: "start",
  skillPaths: [],
};

export const EMPTY_COMPOSER_ATTACHMENTS: StoredDraftAttachment[] = [];

import { useSelector } from "@legendapp/state/react";
import { composerUploads } from "../../data/composer-uploads";
import type { ThreadUiStateRead } from "../../data/use-thread-ui-state";
import type { DraftSelection } from "../../data/voice-draft";
import { useConversationRef } from "../../ui/use-conversation-scope";
import type { QueuedComposerEdit } from "./composerTypes";
import type { ComposerMarkdownInputHandle } from "./input/ComposerMarkdownInput.types";
import { useComposerSession, type ComposerTextSnapshot } from "./composerSession";

export function useComposerDraftState(
  composerScope: string,
  composerState: ThreadUiStateRead,
  queuedComposerEdit: QueuedComposerEdit | null,
) {
  const readyState = composerState.status === "ready" ? composerState.value : null;
  const storedDraft = readyState?.draftText ?? "";

  const storedAttachments = readyState?.attachments ?? EMPTY_COMPOSER_ATTACHMENTS;

  const composerUploadScope =
    queuedComposerEdit === null
      ? composerScope
      : `${composerScope}\u0000queue-edit:${queuedComposerEdit.commandId}`;

  const draft = queuedComposerEdit?.initialText ?? storedDraft;

  const attachments = queuedComposerEdit?.initialAttachments ?? storedAttachments;

  const uploadsBlockSend = useSelector(() => composerUploads.blocksSend(composerUploadScope));

  const composerPreferences = readyState?.preferences ?? EMPTY_COMPOSER_PREFERENCES;

  const composerSession = useComposerSession(composerUploadScope, {
    attachments,
    plainText: draft,
    preferences: composerPreferences,
  });

  const attachmentCount = useSelector(() =>
    composerUploads.count(composerUploadScope, composerSession.snapshot.attachments),
  );

  const draftSelectionRef = useConversationRef<DraftSelection>(composerUploadScope, () => ({
    end: 0,
    start: 0,
  }));

  const composerInputRef = useConversationRef<ComposerMarkdownInputHandle | null>(
    composerScope,
    () => null,
  );

  return {
    attachmentCount,
    attachments: composerSession.snapshot.attachments,
    composerInputRef,
    composerPreferences: composerSession.snapshot.preferences,
    composerSession,
    composerUploadScope,
    draft: composerSession.snapshot.plainText,
    draftSelectionRef,
    uploadsBlockSend,
  };
}

import { useEvent } from "../../react/useEvent";

type DraftMutationCapabilities = {
  composerSession: ReturnType<typeof useComposerSession>;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  queuedComposerEdit: QueuedComposerEdit | null;
  saveDraft: ((connectionId: string, threadId: string, text: string) => Promise<void>) | undefined;
  saveDraftAttachments:
    | ((
        connectionId: string,
        threadId: string,
        attachments: StoredDraftAttachment[],
      ) => Promise<void>)
    | undefined;
};

export function useComposerDraftCommands({
  composerSession,
  draftConnectionId,
  draftThreadId,
  queuedComposerEdit,
  saveDraft,
  saveDraftAttachments,
}: DraftMutationCapabilities) {
  const persistText = (
    owner: ReturnType<typeof composerSession.capture>,
    text: ComposerTextSnapshot,
  ) => {
    const previous = owner.read();
    owner.updateText(text);
    if (previous.plainText === text.plainText) {
      return;
    }
    if (queuedComposerEdit !== null) {
      return;
    }
    if (saveDraft === undefined || draftConnectionId === null || draftThreadId === null) {
      return;
    }
    void saveDraft(draftConnectionId, draftThreadId, text.plainText).catch(() => undefined);
  };

  const updateCurrentText = (text: ComposerTextSnapshot) => {
    persistText(composerSession, text);
  };

  const updateCurrentDraft = (text: string) => {
    updateCurrentText({ markdown: text, plainText: text });
  };

  const persistAttachments = async (
    owner: ReturnType<typeof composerSession.capture>,
    next: StoredDraftAttachment[],
  ): Promise<void> => {
    owner.updateAttachments(next);
    if (queuedComposerEdit !== null) {
      return;
    }
    if (
      saveDraftAttachments === undefined ||
      draftConnectionId === null ||
      draftThreadId === null
    ) {
      return;
    }
    await saveDraftAttachments(draftConnectionId, draftThreadId, next);
  };

  const updateCurrentAttachments = (next: StoredDraftAttachment[]) => {
    void persistAttachments(composerSession, next).catch(() => undefined);
  };
  const updateDraft = useEvent(updateCurrentDraft);
  const updateText = useEvent(updateCurrentText);
  const updateAttachments = useEvent(updateCurrentAttachments);
  // Async work captures both the conversation state owner and persistence
  // coordinates before its first await. Stable UI callbacks continue to use
  // the latest owner, while this object can only mutate the captured session.
  const captureDraftMutations = useEvent(() => {
    const owner = composerSession.capture();
    return {
      updateAttachments: (next: StoredDraftAttachment[]) => {
        void persistAttachments(owner, next).catch(() => undefined);
      },
      updateDraft: (text: string) => {
        persistText(owner, { markdown: text, plainText: text });
      },
    };
  });
  return { captureDraftMutations, updateAttachments, updateDraft, updateText };
}

import type { VoiceInputController } from "../../data/voice-input-controller";
type ComposerEditorEventsCapabilities = Pick<
  ReturnType<typeof useComposerDraftState>,
  "draftSelectionRef"
> & {
  composerScope: string;
  updateDraft: (text: string) => void;
  voiceController: VoiceInputController | null;
};
export function useComposerEditorEvents({
  composerScope,
  draftSelectionRef,
  updateDraft,
  voiceController,
}: ComposerEditorEventsCapabilities) {
  const clearComposerText = useEvent(() => {
    draftSelectionRef.current = { end: 0, start: 0 };
    voiceController?.clearPendingSelection(composerScope);
    updateDraft("");
  });
  return { clearComposerText };
}
