import type { SelectedUpload } from "../../../native/file-transfer";
import { useEvent } from "../../../react/useEvent";
import { useAttachmentAdmission, useDrawingAttachmentRead } from "./attachmentAdmission";
import { useAttachmentRemoval } from "./attachmentRemoval";
import { useLargePasteActions } from "./largePaste";
import { useReviewAdmission } from "./reviewAdmission";
/** Composes the existing ComposerAttachments owners without adding state or lifecycle policy. */
export function useComposerAttachments({
  composerScope,
  composerUploadScope,
  draftConnectionId,
  draftThreadId,
  getTransferAccess,
  getStableTransferAccess,
  queuedComposerEdit,
  upsertDraftAttachment,
  latestAttachmentsRef,
  captureDraftMutations,
  fileTransferController,
  attachmentCount,
  setComposerTrayVisible,
  dismissComposerKeyboardForOverlay,
  contentReviewAttachmentId,
  setContentReviewAttachmentId,
  latestDraftRef,
  draftSelectionRef,
  voiceController,
  setPastedAttachmentPending,
  pastedAttachmentPendingRef,
  largePasteOperationRef,
  updateAttachments,
  removeDraftAttachment,
}: {
  composerScope: Parameters<typeof useAttachmentRemoval>[0]["composerScope"];
  composerUploadScope: Parameters<typeof useAttachmentRemoval>[0]["composerUploadScope"];
  draftConnectionId: Parameters<typeof useAttachmentRemoval>[0]["draftConnectionId"];
  draftThreadId: Parameters<typeof useAttachmentRemoval>[0]["draftThreadId"];
  getTransferAccess: Parameters<typeof useAttachmentAdmission>[0]["getTransferAccess"];
  getStableTransferAccess: Parameters<typeof useAttachmentAdmission>[0]["getStableTransferAccess"];
  queuedComposerEdit: Parameters<typeof useAttachmentRemoval>[0]["queuedComposerEdit"];
  upsertDraftAttachment: Parameters<typeof useAttachmentAdmission>[0]["upsertDraftAttachment"];
  latestAttachmentsRef: Parameters<typeof useAttachmentRemoval>[0]["latestAttachmentsRef"];
  captureDraftMutations: Parameters<typeof useLargePasteActions>[0]["captureDraftMutations"];
  fileTransferController: Parameters<typeof useAttachmentAdmission>[0]["fileTransferController"];
  attachmentCount: Parameters<typeof useAttachmentAdmission>[0]["attachmentCount"];
  setComposerTrayVisible: Parameters<typeof useAttachmentAdmission>[0]["setComposerTrayVisible"];
  dismissComposerKeyboardForOverlay: Parameters<
    typeof useAttachmentAdmission
  >[0]["dismissComposerKeyboardForOverlay"];
  contentReviewAttachmentId: Parameters<
    typeof useAttachmentRemoval
  >[0]["contentReviewAttachmentId"];
  setContentReviewAttachmentId: Parameters<
    typeof useAttachmentRemoval
  >[0]["setContentReviewAttachmentId"];
  latestDraftRef: Parameters<typeof useLargePasteActions>[0]["latestDraftRef"];
  draftSelectionRef: Parameters<typeof useLargePasteActions>[0]["draftSelectionRef"];
  voiceController: Parameters<typeof useLargePasteActions>[0]["voiceController"];
  setPastedAttachmentPending: Parameters<
    typeof useLargePasteActions
  >[0]["setPastedAttachmentPending"];
  pastedAttachmentPendingRef: Parameters<
    typeof useLargePasteActions
  >[0]["pastedAttachmentPendingRef"];
  largePasteOperationRef: Parameters<typeof useLargePasteActions>[0]["largePasteOperationRef"];
  updateAttachments: Parameters<typeof useAttachmentRemoval>[0]["updateAttachments"];
  removeDraftAttachment: Parameters<typeof useAttachmentRemoval>[0]["removeDraftAttachment"];
}) {
  const {
    fileAttachmentEnabled,
    captureStageAttachment,
    captureUploadAttachment,
    pickComposerAttachment,
  } = useAttachmentAdmission({
    composerScope,
    composerUploadScope,
    draftConnectionId,
    draftThreadId,
    getTransferAccess,
    getStableTransferAccess,
    queuedComposerEdit,
    upsertDraftAttachment,
    latestAttachmentsRef,
    captureDraftMutations,
    fileTransferController,
    attachmentCount,
    setComposerTrayVisible,
    dismissComposerKeyboardForOverlay,
  });
  const reviewAdmission = useReviewAdmission(
    composerScope,
    contentReviewAttachmentId,
    captureDraftMutations,
    captureUploadAttachment,
    setContentReviewAttachmentId,
  );
  const admitContentReview = useEvent((selected: SelectedUpload) =>
    reviewAdmission.admitContentReview(selected, () => latestAttachmentsRef.current.latest),
  );
  const { readDrawingAttachments } = useDrawingAttachmentRead(
    composerUploadScope,
    latestAttachmentsRef,
  );
  const { handleComposerLargePaste } = useLargePasteActions({
    composerScope,
    draftConnectionId,
    draftThreadId,
    latestDraftRef,
    draftSelectionRef,
    voiceController,
    captureDraftMutations,
    captureStageAttachment,
    setPastedAttachmentPending,
    pastedAttachmentPendingRef,
    largePasteOperationRef,
  });
  const { removeComposerAttachment } = useAttachmentRemoval({
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
  });
  return {
    reviewAdmission,
    admitContentReview,
    fileAttachmentEnabled,
    readDrawingAttachments,
    captureStageAttachment,
    pickComposerAttachment,
    removeComposerAttachment,
    handleComposerLargePaste,
  };
}
