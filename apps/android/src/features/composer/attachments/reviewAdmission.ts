import { useState } from "react";
import type { SelectedUpload } from "../../../native/file-transfer";
import { useEvent } from "../../../react/useEvent";

export function useReviewAttachmentIds(composerScope: string) {
  const [contentReviewAttachmentIds, setContentReviewAttachmentIds] = useState(
    () => new Map<string, string>(),
  );

  const contentReviewAttachmentId = contentReviewAttachmentIds.get(composerScope) ?? null;

  const setContentReviewAttachmentId = useEvent((scope: string, attachmentId: string | null) => {
    setContentReviewAttachmentIds((current) => {
      if ((current.get(scope) ?? null) === attachmentId) {
        return current;
      }
      const next = new Map(current);
      if (attachmentId === null) {
        next.delete(scope);
      } else {
        next.set(scope, attachmentId);
      }
      return next;
    });
  });

  const clearContentReviewAttachmentId = useEvent((scope: string, expectedAttachmentId: string) => {
    setContentReviewAttachmentIds((current) => {
      if (current.get(scope) !== expectedAttachmentId) {
        return current;
      }
      const next = new Map(current);
      next.delete(scope);
      return next;
    });
  });
  return {
    clearContentReviewAttachmentId,
    contentReviewAttachmentId,
    setContentReviewAttachmentId,
  };
}

import type { StoredDraftAttachment } from "../../../data/thread-ui-state-types";

/** The existing upload admission retains its selected callback and failure behavior. */
type ReviewUpload = (
  selected: SelectedUpload,
  onUploaded?: (attachment: StoredDraftAttachment) => void,
  offerRetry?: boolean,
) => Promise<StoredDraftAttachment | null>;

export function useReviewAdmission(
  composerScope: string,
  contentReviewAttachmentId: string | null,
  captureDraftMutations: () => {
    updateAttachments: (attachments: StoredDraftAttachment[]) => void;
  },
  captureUploadAttachment: () => ReviewUpload,
  setContentReviewAttachmentId: (scope: string, attachmentId: string | null) => void,
) {
  const admitCodeReview = useEvent(
    async (selected: SelectedUpload) => (await captureUploadAttachment()(selected)) !== null,
  );
  const admitContentReview = useEvent(
    async (
      selected: SelectedUpload,
      readLatestAttachments: () => StoredDraftAttachment[],
    ): Promise<string | null> => {
      const { updateAttachments } = captureDraftMutations();
      const uploadSelectedAttachment = captureUploadAttachment();
      const scope = composerScope;
      const previousAttachmentId = contentReviewAttachmentId;
      return uploadSelectedAttachment(selected, (attachment) => {
        const current = readLatestAttachments();
        updateAttachments([
          ...current.filter(
            (candidate) => candidate.id !== previousAttachmentId && candidate.id !== attachment.id,
          ),
          attachment,
        ]);
        setContentReviewAttachmentId(scope, attachment.id);
      }).then((attachment) => attachment?.id ?? null);
    },
  );
  return { admitCodeReview, admitContentReview };
}
