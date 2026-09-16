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
import type { ThreadUiStateRow } from "../../data/thread-ui-state-types";
import type { DraftSelection } from "../../data/voice-draft";
import { useConversationRef } from "../../ui/use-conversation-scope";
import type { QueuedComposerEdit } from "./composerTypes";
import type { ComposerMarkdownInputHandle } from "./input/ComposerMarkdownInput.types";
import { useComposerLatestValues } from "./useComposerLatestValues";

export function useComposerDraftState(
  composerScope: string,
  composerState: ThreadUiStateRow | null,
  queuedComposerEdit: QueuedComposerEdit | null,
) {
  const storedDraft = composerState?.draftText ?? "";

  const storedAttachments = composerState?.attachments ?? EMPTY_COMPOSER_ATTACHMENTS;

  const composerUploadScope =
    queuedComposerEdit === null
      ? composerScope
      : `${composerScope}\u0000queue-edit:${queuedComposerEdit.commandId}`;

  const draft = queuedComposerEdit?.text ?? storedDraft;

  const attachments = queuedComposerEdit?.attachments ?? storedAttachments;

  const uploadsBlockSend = useSelector(() => composerUploads.blocksSend(composerUploadScope));

  const attachmentCount = useSelector(() =>
    composerUploads.count(composerUploadScope, attachments),
  );

  const composerPreferences = composerState?.preferences ?? EMPTY_COMPOSER_PREFERENCES;

  const latestComposerValues = useComposerLatestValues(
    composerUploadScope,
    draft,
    attachments,
    composerPreferences,
  );

  const latestDraftRef = latestComposerValues.draft;

  const latestAttachmentsRef = latestComposerValues.attachments;

  const latestComposerPreferencesRef = latestComposerValues.preferences;

  const composerStateMissing = composerState === null;

  const draftSelectionRef = useConversationRef<DraftSelection>(composerUploadScope, () => ({
    end: 0,
    start: 0,
  }));

  const composerInputRef = useConversationRef<ComposerMarkdownInputHandle | null>(
    composerScope,
    () => null,
  );

  const composerMarkdownRef = useConversationRef(composerUploadScope, () => draft);
  return {
    attachmentCount,
    attachments,
    composerInputRef,
    composerMarkdownRef,
    composerPreferences,
    composerStateMissing,
    composerUploadScope,
    draft,
    draftSelectionRef,
    latestAttachmentsRef,
    latestComposerPreferencesRef,
    latestDraftRef,
    uploadsBlockSend,
  };
}

import type { Dispatch, SetStateAction } from "react";
import { useEvent } from "../../react/useEvent";

type DraftMutationCapabilities = {
  composerMarkdownRef: { current: string };
  draftConnectionId: string | null;
  draftThreadId: string | null;
  latestAttachmentsRef: { current: { latest: StoredDraftAttachment[] } };
  latestDraftRef: { current: { latest: string } };
  queuedComposerEdit: QueuedComposerEdit | null;
  saveDraft: ((connectionId: string, threadId: string, text: string) => Promise<void>) | undefined;
  saveDraftAttachments:
    | ((
        connectionId: string,
        threadId: string,
        attachments: StoredDraftAttachment[],
      ) => Promise<void>)
    | undefined;
  setQueuedComposerEdit: Dispatch<SetStateAction<QueuedComposerEdit | null>>;
};

export function useComposerDraftCommands({
  composerMarkdownRef,
  draftConnectionId,
  draftThreadId,
  latestAttachmentsRef,
  latestDraftRef,
  queuedComposerEdit,
  saveDraft,
  saveDraftAttachments,
  setQueuedComposerEdit,
}: DraftMutationCapabilities) {
  const updateCurrentDraft = (text: string) => {
    latestDraftRef.current.latest = text;
    composerMarkdownRef.current = text;
    if (queuedComposerEdit !== null) {
      setQueuedComposerEdit((current) => (current === null ? null : { ...current, text }));
      return;
    }
    if (saveDraft === undefined || draftConnectionId === null || draftThreadId === null) {
      return;
    }
    void saveDraft(draftConnectionId, draftThreadId, text).catch(() => undefined);
  };

  const persistAttachments = async (next: StoredDraftAttachment[]): Promise<void> => {
    latestAttachmentsRef.current.latest = next;
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
    if (queuedComposerEdit !== null) {
      latestAttachmentsRef.current.latest = next;
      setQueuedComposerEdit((current) =>
        current === null ? null : { ...current, attachments: next },
      );
      return;
    }
    void persistAttachments(next).catch(() => undefined);
  };
  const updateDraft = useEvent(updateCurrentDraft);
  const updateAttachments = useEvent(updateCurrentAttachments);
  // Async work captures these activation-bound mutations before its first await.
  const captureDraftMutations = useEvent(() => ({
    updateAttachments: updateCurrentAttachments,
    updateDraft: updateCurrentDraft,
  }));
  return { captureDraftMutations, updateAttachments, updateDraft };
}

import { useAsyncResource } from "../../rendering/async-resource-store";
/** Select the shared lower seed operation without introducing an effect-owned load. */
export function useComposerSeed(
  composerScope: string,
  composerStateMissing: boolean,
  loadDraft: ((connectionId: string, threadId: string) => Promise<string>) | undefined,
  draftConnectionId: string | null,
  draftThreadId: string | null,
) {
  const composerSeedTaskKey =
    !composerStateMissing ||
    loadDraft === undefined ||
    draftConnectionId === null ||
    draftThreadId === null
      ? null
      : `composer-seed:${composerScope}`;
  useAsyncResource<boolean>("active-composer-seed", composerSeedTaskKey ?? "inactive", async () => {
    if (
      composerSeedTaskKey === null ||
      loadDraft === undefined ||
      draftConnectionId === null ||
      draftThreadId === null
    ) {
      return false;
    }
    // Migration/read owns the transition into the TanStack row. React only
    // observes that row and never mirrors the native composer state locally.
    await loadDraft(draftConnectionId, draftThreadId);
    return true;
  });
}

import type { VoiceInputController } from "../../data/voice-input-controller";
type ComposerEditorEventsCapabilities = Pick<
  ReturnType<typeof useComposerDraftState>,
  "composerMarkdownRef" | "draftSelectionRef"
> & {
  composerScope: string;
  updateDraft: (text: string) => void;
  voiceController: VoiceInputController | null;
};
export function useComposerEditorEvents({
  composerMarkdownRef,
  composerScope,
  draftSelectionRef,
  updateDraft,
  voiceController,
}: ComposerEditorEventsCapabilities) {
  const handleComposerMarkdownChange = useEvent((markdown: string) => {
    composerMarkdownRef.current = markdown;
  });

  const clearComposerText = useEvent(() => {
    draftSelectionRef.current = { end: 0, start: 0 };
    voiceController?.clearPendingSelection(composerScope);
    updateDraft("");
  });
  return { clearComposerText, handleComposerMarkdownChange };
}
