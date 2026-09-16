import type { StoredDraftAttachment } from "../../../data/thread-ui-state-types";
import { composerUploads } from "../../../data/composer-uploads";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../../ui/AppDialog";
import type { QueuedComposerEdit } from "../composerTypes";

type AttachmentRemovalCapabilities = {
  composerScope: string;
  composerUploadScope: string;
  contentReviewAttachmentId: string | null;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  latestAttachmentsRef: { current: { latest: StoredDraftAttachment[] } };
  queuedComposerEdit: QueuedComposerEdit | null;
  removeDraftAttachment:
    | ((connectionId: string, threadId: string, attachmentId: string) => Promise<void>)
    | undefined;
  setContentReviewAttachmentId: (scope: string, attachmentId: string | null) => void;
  updateAttachments: (attachments: StoredDraftAttachment[]) => void;
};
/** Removes staged or durable attachments from the active draft's qualified owner. */
export function useAttachmentRemoval({
  composerScope,
  composerUploadScope,
  contentReviewAttachmentId,
  draftConnectionId,
  draftThreadId,
  latestAttachmentsRef,
  queuedComposerEdit,
  removeDraftAttachment,
  setContentReviewAttachmentId,
  updateAttachments,
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
      void removeDraftAttachment(draftConnectionId, draftThreadId, attachmentId).catch(() => {
        dialog.alert("Could not remove attachment", "Please try again.");
      });
    }
    if (contentReviewAttachmentId === attachmentId) {
      setContentReviewAttachmentId(composerScope, null);
    }
  });
  return { removeComposerAttachment };
}
