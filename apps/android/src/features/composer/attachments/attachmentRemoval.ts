import { composerUploads } from "../../../data/composer-uploads";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../../ui/AppDialog";
import type { QueuedComposerEdit } from "../composerTypes";
import type { ComposerSessionBinding } from "../composerSession";

type AttachmentRemovalCapabilities = {
  composerScope: string;
  composerSession: ComposerSessionBinding;
  composerUploadScope: string;
  contentReviewAttachmentId: string | null;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  queuedComposerEdit: QueuedComposerEdit | null;
  removeDraftAttachment:
    | ((connectionId: string, threadId: string, attachmentId: string) => Promise<void>)
    | undefined;
  setContentReviewAttachmentId: (scope: string, attachmentId: string | null) => void;
};
/** Removes staged or durable attachments from the active draft's qualified owner. */
export function useAttachmentRemoval({
  composerScope,
  composerSession,
  composerUploadScope,
  contentReviewAttachmentId,
  draftConnectionId,
  draftThreadId,
  queuedComposerEdit,
  removeDraftAttachment,
  setContentReviewAttachmentId,
}: AttachmentRemovalCapabilities) {
  const dialog = useAppDialog();
  const removeComposerAttachment = useEvent((attachmentId: string) => {
    composerUploads.remove(composerUploadScope, attachmentId);
    const session = composerSession.capture();
    const currentAttachments = session.read().attachments;
    const removedIndex = currentAttachments.findIndex((candidate) => candidate.id === attachmentId);
    const removed = removedIndex < 0 ? undefined : currentAttachments[removedIndex];
    const next = currentAttachments.filter((candidate) => candidate.id !== attachmentId);
    session.updateAttachments(next);
    if (queuedComposerEdit !== null) {
      return;
    }
    if (
      draftConnectionId !== null &&
      draftThreadId !== null &&
      removeDraftAttachment !== undefined
    ) {
      void removeDraftAttachment(draftConnectionId, draftThreadId, attachmentId).catch(() => {
        if (removed !== undefined) {
          const current = session.read().attachments;
          const restored = current.slice();
          restored.splice(Math.min(removedIndex, restored.length), 0, removed);
          session.updateAttachments(restored);
        }
        dialog.alert("Could not remove attachment", "Please try again.");
      });
    }
    if (contentReviewAttachmentId === attachmentId) {
      setContentReviewAttachmentId(composerScope, null);
    }
  });
  return { removeComposerAttachment };
}
