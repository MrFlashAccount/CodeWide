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
    setQueuedComposerEdit,
    queuedComposerEditBusy,
    setQueuedComposerEditBusy,
    queuedComposerEditError,
    setQueuedComposerEditError,
  };
}

import { composerUploads } from "../../data/composer-uploads";
import type { QueuedPrompt } from "../../data/thread-delivery-state";
import type { QueueEditCapabilities } from "./queueEditCapabilities";
import { markdownForComposerSubmission } from "./skills/composer-skill-suggestions";
export function useQueueEditActions({
  queuedComposerEdit,
  setQueuedComposerEdit,
  queuedComposerEditBusy,
  setQueuedComposerEditBusy,
  setQueuedComposerEditError,
  composerUploadScope,
  draftSelectionRef,
  composerInputRef,
  composerMarkdownRef,
  latestAttachmentsRef,
  uploadsBlockSend,
  voicePhase,
  closeInlineQueueOverlay,
  setMenuVisible,
  onEditQueued,
  onListQueue,
  conversationOwner,
}: QueueEditCapabilities) {
  const clearQueuedComposerUploads = (scope: string) => {
    for (const upload of composerUploads.entries(scope))
      composerUploads.remove(scope, upload.attachment.id);
  };

  const cancelQueuedComposerEdit = useEvent(() => {
    if (queuedComposerEdit === null) return;
    clearQueuedComposerUploads(composerUploadScope);
    setQueuedComposerEdit(null);
    setQueuedComposerEditBusy(false);
    setQueuedComposerEditError(null);
    draftSelectionRef.current = { start: 0, end: 0 };
  });

  const beginQueuedComposerEdit = useEvent((item: QueuedPrompt) => {
    if (queuedComposerEditBusy || voicePhase !== "idle" || item.state !== "queued") return;
    if (queuedComposerEdit !== null) clearQueuedComposerUploads(composerUploadScope);
    closeInlineQueueOverlay();
    setQueuedComposerEdit({
      commandId: item.commandId,
      text: item.text,
      attachments: item.attachments,
    });
    setQueuedComposerEditError(null);
    setMenuVisible(false);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  });

  const saveQueuedComposerEdit = useEvent(() => {
    const edit = queuedComposerEdit;
    if (edit === null || onEditQueued === undefined || queuedComposerEditBusy || uploadsBlockSend)
      return;
    const text = markdownForComposerSubmission(composerMarkdownRef.current).trim();
    const editedAttachments = composerUploads.readyAttachments(
      composerUploadScope,
      latestAttachmentsRef.current.latest,
    );
    if (text === "" && editedAttachments.length === 0) return;
    const editScope = composerUploadScope;
    setQueuedComposerEditBusy(true);
    setQueuedComposerEditError(null);
    void onEditQueued(edit.commandId, text, editedAttachments).then(
      () => {
        if (conversationOwner.isCurrent()) {
          clearQueuedComposerUploads(editScope);
          setQueuedComposerEdit(null);
          setQueuedComposerEditBusy(false);
          draftSelectionRef.current = { start: 0, end: 0 };
          if (onListQueue !== undefined) void onListQueue().catch(() => undefined);
        }
      },
      (cause: unknown) => {
        if (!conversationOwner.isCurrent()) return;
        setQueuedComposerEditError(
          cause instanceof Error ? cause.message : "Could not update queued message",
        );
        setQueuedComposerEditBusy(false);
      },
    );
  });
  return { cancelQueuedComposerEdit, beginQueuedComposerEdit, saveQueuedComposerEdit };
}
