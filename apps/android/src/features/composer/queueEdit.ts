import { useEvent } from "../../react/useEvent";
import { useConversationState } from "../../ui/use-conversation-scope";
import type { QueuedComposerEdit } from "./composerTypes";

export function useQueueEditState(composerScope: string) {
  const [queuedComposerEdit, setQueuedComposerEdit] =
    useConversationState<QueuedComposerEdit | null>(composerScope, () => null);

  const [queuedComposerEditBusy, setQueuedComposerEditBusy] = useConversationState(
    composerScope,
    () => false,
  );

  const [queuedComposerEditError, setQueuedComposerEditError] = useConversationState<string | null>(
    composerScope,
    () => null,
  );
  return {
    queuedComposerEdit,
    queuedComposerEditBusy,
    queuedComposerEditError,
    setQueuedComposerEdit,
    setQueuedComposerEditBusy,
    setQueuedComposerEditError,
  };
}

import { composerUploads } from "../../data/composer-uploads";
import type { QueuedPrompt } from "../../data/thread-delivery-state";
import type { QueueEditCapabilities } from "./queueEditCapabilities";
import { markdownForComposerSubmission } from "./skills/composer-skill-suggestions";

function clearQueuedComposerUploads(scope: string): void {
  for (const upload of composerUploads.entries(scope)) {
    composerUploads.remove(scope, upload.attachment.id);
  }
}

export function useQueueEditActions({
  closeInlineQueueOverlay,
  composerInputRef,
  composerMarkdownRef,
  composerUploadScope,
  conversationOwner,
  draftSelectionRef,
  latestAttachmentsRef,
  onEditQueued,
  onListQueue,
  queuedComposerEdit,
  queuedComposerEditBusy,
  setQueuedComposerEdit,
  setQueuedComposerEditBusy,
  setQueuedComposerEditError,
  uploadsBlockSend,
  voicePhase,
}: QueueEditCapabilities) {
  const cancelQueuedComposerEdit = useEvent(() => {
    if (queuedComposerEdit === null) {
      return;
    }
    clearQueuedComposerUploads(composerUploadScope);
    setQueuedComposerEdit(null);
    setQueuedComposerEditBusy(false);
    setQueuedComposerEditError(null);
    draftSelectionRef.current = { end: 0, start: 0 };
  });

  const beginQueuedComposerEdit = useEvent((item: QueuedPrompt) => {
    if (queuedComposerEditBusy || voicePhase !== "idle" || item.state !== "queued") {
      return;
    }
    if (queuedComposerEdit !== null) {
      clearQueuedComposerUploads(composerUploadScope);
    }
    closeInlineQueueOverlay();
    setQueuedComposerEdit({
      attachments: item.attachments,
      commandId: item.commandId,
      text: item.text,
    });
    setQueuedComposerEditError(null);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  });

  const saveQueuedComposerEdit = useEvent(() => {
    const edit = queuedComposerEdit;
    if (edit === null || onEditQueued === undefined || queuedComposerEditBusy || uploadsBlockSend) {
      return;
    }
    const text = markdownForComposerSubmission(composerMarkdownRef.current).trim();
    const editedAttachments = composerUploads.readyAttachments(
      composerUploadScope,
      latestAttachmentsRef.current.latest,
    );
    if (text === "" && editedAttachments.length === 0) {
      return;
    }
    const editScope = composerUploadScope;
    setQueuedComposerEditBusy(true);
    setQueuedComposerEditError(null);
    void onEditQueued(edit.commandId, text, editedAttachments).then(
      () => {
        if (conversationOwner.isCurrent()) {
          clearQueuedComposerUploads(editScope);
          setQueuedComposerEdit(null);
          setQueuedComposerEditBusy(false);
          draftSelectionRef.current = { end: 0, start: 0 };
          if (onListQueue !== undefined) {
            void onListQueue().catch(() => undefined);
          }
        }
      },
      (error: unknown) => {
        if (!conversationOwner.isCurrent()) {
          return;
        }
        setQueuedComposerEditError(
          error instanceof Error ? error.message : "Could not update queued message",
        );
        setQueuedComposerEditBusy(false);
      },
    );
  });
  return { beginQueuedComposerEdit, cancelQueuedComposerEdit, saveQueuedComposerEdit };
}
