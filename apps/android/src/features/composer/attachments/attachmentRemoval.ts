import type { StoredDraftAttachment } from "../../../data/thread-ui-state-types";
import { composerUploads } from "../../../data/composer-uploads";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../../ui/AppDialog";
import type { QueuedComposerEdit } from "../composerTypes";

type AttachmentRemovalCapabilities = {
  composerUploadScope: string;
  queuedComposerEdit: QueuedComposerEdit | null;
  updateAttachments(attachments: StoredDraftAttachment[]): void;
  latestAttachmentsRef: { current: { latest: StoredDraftAttachment[] } };
  draftConnectionId: string | null;
  draftThreadId: string | null;
  removeDraftAttachment:
    | ((connectionId: string, threadId: string, attachmentId: string) => Promise<void>)
    | undefined;
  contentReviewAttachmentId: string | null;
  setContentReviewAttachmentId(scope: string, attachmentId: string | null): void;
  composerScope: string;
};
/** Removes staged or durable attachments from the active draft's qualified owner. */
export function useAttachmentRemoval({
  composerUploadScope,
  queuedComposerEdit,
  updateAttachments,
  latestAttachmentsRef,
  draftConnectionId,
  draftThreadId,
  removeDraftAttachment,
  contentReviewAttachmentId,
  setContentReviewAttachmentId,
  composerScope,
}: AttachmentRemovalCapabilities) {
  const dialog = useAppDialog();
  const removeComposerAttachment = useEvent((attachmentId: string) => {
    composerUploads.remove(composerUploadScope, attachmentId);
    if (queuedComposerEdit !== null) {
      updateAttachments(
        latestAttachmentsRef.current.latest.filter((candidate) => candidate.id !== attachmentId),
      );
      return;
    }
    if (
      draftConnectionId !== null &&
      draftThreadId !== null &&
      removeDraftAttachment !== undefined
    ) {
      void removeDraftAttachment(draftConnectionId, draftThreadId, attachmentId).catch(() =>
        dialog.alert("Could not remove attachment", "Please try again."),
      );
    }
    if (contentReviewAttachmentId === attachmentId)
      setContentReviewAttachmentId(composerScope, null);
  });
  return { removeComposerAttachment };
}
