import type { SelectedUpload } from "../../../native/file-transfer";
import { useEvent } from "../../../react/useEvent";
import { useAttachmentAdmission, useDrawingAttachmentRead } from "./attachmentAdmission";
import { useAttachmentRemoval } from "./attachmentRemoval";
import { useLargePasteActions } from "./largePaste";
import { useReviewAdmission } from "./reviewAdmission";
/** Composes the existing ComposerAttachments owners without adding state or lifecycle policy. */
export function useComposerAttachments({
  attachmentCount,
  captureDraftMutations,
  composerScope,
  composerUploadScope,
  contentReviewAttachmentId,
  dismissComposerKeyboardForOverlay,
  draftConnectionId,
  draftSelectionRef,
  draftThreadId,
  fileTransferController,
  getStableTransferAccess,
  getTransferAccess,
  largePasteOperationRef,
  latestAttachmentsRef,
  latestDraftRef,
  pastedAttachmentPendingRef,
  queuedComposerEdit,
  removeDraftAttachment,
  setComposerTrayVisible,
  setContentReviewAttachmentId,
  setPastedAttachmentPending,
  updateAttachments,
  upsertDraftAttachment,
  voiceController,
}: {
  attachmentCount: Parameters<typeof useAttachmentAdmission>[0]["attachmentCount"];
  captureDraftMutations: Parameters<typeof useLargePasteActions>[0]["captureDraftMutations"];
  composerScope: Parameters<typeof useAttachmentRemoval>[0]["composerScope"];
  composerUploadScope: Parameters<typeof useAttachmentRemoval>[0]["composerUploadScope"];
  contentReviewAttachmentId: Parameters<
    typeof useAttachmentRemoval
  >[0]["contentReviewAttachmentId"];
  dismissComposerKeyboardForOverlay: Parameters<
    typeof useAttachmentAdmission
  >[0]["dismissComposerKeyboardForOverlay"];
  draftConnectionId: Parameters<typeof useAttachmentRemoval>[0]["draftConnectionId"];
  draftSelectionRef: Parameters<typeof useLargePasteActions>[0]["draftSelectionRef"];
  draftThreadId: Parameters<typeof useAttachmentRemoval>[0]["draftThreadId"];
  fileTransferController: Parameters<typeof useAttachmentAdmission>[0]["fileTransferController"];
  getStableTransferAccess: Parameters<typeof useAttachmentAdmission>[0]["getStableTransferAccess"];
  getTransferAccess: Parameters<typeof useAttachmentAdmission>[0]["getTransferAccess"];
  largePasteOperationRef: Parameters<typeof useLargePasteActions>[0]["largePasteOperationRef"];
  latestAttachmentsRef: Parameters<typeof useAttachmentRemoval>[0]["latestAttachmentsRef"];
  latestDraftRef: Parameters<typeof useLargePasteActions>[0]["latestDraftRef"];
  pastedAttachmentPendingRef: Parameters<
    typeof useLargePasteActions
  >[0]["pastedAttachmentPendingRef"];
  queuedComposerEdit: Parameters<typeof useAttachmentRemoval>[0]["queuedComposerEdit"];
  removeDraftAttachment: Parameters<typeof useAttachmentRemoval>[0]["removeDraftAttachment"];
  setComposerTrayVisible: Parameters<typeof useAttachmentAdmission>[0]["setComposerTrayVisible"];
  setContentReviewAttachmentId: Parameters<
    typeof useAttachmentRemoval
  >[0]["setContentReviewAttachmentId"];
  setPastedAttachmentPending: Parameters<
    typeof useLargePasteActions
  >[0]["setPastedAttachmentPending"];
  updateAttachments: Parameters<typeof useAttachmentRemoval>[0]["updateAttachments"];
  upsertDraftAttachment: Parameters<typeof useAttachmentAdmission>[0]["upsertDraftAttachment"];
  voiceController: Parameters<typeof useLargePasteActions>[0]["voiceController"];
}) {
  const {
    captureStageAttachment,
    captureUploadAttachment,
    fileAttachmentEnabled,
    pickComposerAttachment,
  } = useAttachmentAdmission({
    attachmentCount,
    captureDraftMutations,
    composerScope,
    composerUploadScope,
    dismissComposerKeyboardForOverlay,
    draftConnectionId,
    draftThreadId,
    fileTransferController,
    getStableTransferAccess,
    getTransferAccess,
    latestAttachmentsRef,
    queuedComposerEdit,
    setComposerTrayVisible,
    upsertDraftAttachment,
  });
  const reviewAdmission = useReviewAdmission(
    composerScope,
    contentReviewAttachmentId,
    captureDraftMutations,
    captureUploadAttachment,
    setContentReviewAttachmentId,
  );
  const admitContentReview = useEvent(async (selected: SelectedUpload) =>
    reviewAdmission.admitContentReview(selected, () => latestAttachmentsRef.current.latest),
  );
  const { readDrawingAttachments } = useDrawingAttachmentRead(
    composerUploadScope,
    latestAttachmentsRef,
  );
  const { handleComposerLargePaste } = useLargePasteActions({
    captureDraftMutations,
    captureStageAttachment,
    composerScope,
    draftConnectionId,
    draftSelectionRef,
    draftThreadId,
    largePasteOperationRef,
    latestDraftRef,
    pastedAttachmentPendingRef,
    setPastedAttachmentPending,
    voiceController,
  });
  const { removeComposerAttachment } = useAttachmentRemoval({
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
  });
  return {
    admitContentReview,
    captureStageAttachment,
    fileAttachmentEnabled,
    handleComposerLargePaste,
    pickComposerAttachment,
    readDrawingAttachments,
    removeComposerAttachment,
    reviewAdmission,
  };
}
