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
import { composerTextForSubmission } from "./composerSubmissionText";

function clearQueuedComposerUploads(scope: string): void {
  for (const upload of composerUploads.entries(scope)) {
    composerUploads.remove(scope, upload.attachment.id);
  }
}

export function useQueueEditActions({
  closeInlineQueueOverlay,
  composerInputRef,
  composerSession,
  composerUploadScope,
  conversationOwner,
  draftSelectionRef,
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
      commandId: item.commandId,
      initialAttachments: item.attachments,
      initialText: item.text,
    });
    setQueuedComposerEditError(null);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  });

  const saveQueuedComposerEdit = useEvent(() => {
    const edit = queuedComposerEdit;
    if (edit === null || onEditQueued === undefined || queuedComposerEditBusy || uploadsBlockSend) {
      return;
    }
    const session = composerSession.capture();
    const snapshot = session.read();
    const initialText = composerTextForSubmission(snapshot).trim();
    const editedAttachments = composerUploads.readyAttachments(
      composerUploadScope,
      snapshot.attachments,
    );
    if (initialText === "" && editedAttachments.length === 0) {
      return;
    }
    const editScope = composerUploadScope;
    const input = composerInputRef.current;
    setQueuedComposerEditBusy(true);
    setQueuedComposerEditError(null);
    const update = async (): Promise<void> => {
      let text = initialText;
      if (text === "" && editedAttachments.length > 0 && input !== null) {
        try {
          const nativeValue = await input.getValue();
          session.updateText(nativeValue);
          text = composerTextForSubmission(nativeValue).trim();
        } catch {
          // The attachment edit remains valid if its resident editor unmounts
          // before the consistency read completes.
        }
      }
      await onEditQueued(edit.commandId, text, editedAttachments);
    };
    void update().then(
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
