import { fileMediaKind } from "@codewide/file-types";
import { MAX_TURN_ATTACHMENTS } from "@codewide/sync-client";
import { randomUUID } from "expo-crypto";
import { ATTACHMENT_ROOT_ID, attachmentUploadPath } from "../../../data/attachment-upload";
import { composerUploads } from "../../../data/composer-uploads";
import type { StoredDraftAttachment } from "../../../data/thread-ui-state-types";
import {
  pickUploadFile,
  selectedUploadText,
  selectedUploadUri,
  startUpload,
  type SelectedUpload,
} from "../../../native/file-transfer";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../../ui/AppDialog";
import type { AttachmentAdmissionCapabilities } from "./attachmentCapabilities";
export function useAttachmentAdmission({
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
}: AttachmentAdmissionCapabilities) {
  const dialog = useAppDialog();
  const fileAttachmentEnabled =
    fileTransferController !== null &&
    getTransferAccess !== undefined &&
    draftThreadId !== null &&
    attachmentCount < MAX_TURN_ATTACHMENTS;
  const captureStageAttachment = useEvent(() => {
    const { updateAttachments } = captureDraftMutations();
    const stageAttachment = (
      selected: SelectedUpload,
      existing: StoredDraftAttachment | null = null,
      editor?: StoredDraftAttachment["editor"],
    ): boolean => {
      if (
        draftConnectionId === null ||
        draftThreadId === null ||
        getTransferAccess === undefined ||
        (queuedComposerEdit === null && upsertDraftAttachment === undefined)
      )
        return false;
      if (
        existing === null &&
        composerUploads.count(composerUploadScope, latestAttachmentsRef.current.latest) >=
          MAX_TURN_ATTACHMENTS
      ) {
        dialog.alert(
          "Too many attachments",
          `A message can contain at most ${MAX_TURN_ATTACHMENTS} attachments.`,
        );
        return false;
      }
      const path = existing?.path ?? attachmentUploadPath(draftThreadId, selected.name);
      const attachment: StoredDraftAttachment = {
        id: existing?.id ?? randomUUID(),
        rootId: existing?.rootId ?? ATTACHMENT_ROOT_ID,
        path,
        name: selected.name,
        kind: fileMediaKind(selected.name, selected.mimeType) ?? "file",
        ...(editor === undefined ? {} : { editor }),
      };
      composerUploads.stage({
        scope: composerUploadScope,
        attachment,
        preview: {
          uri: selectedUploadUri(selected),
          text: null,
          bytes: selected.size,
          mimeType: selected.mimeType,
        },
        start: (progress) =>
          startUpload(
            getTransferAccess,
            selected,
            attachment.rootId,
            path,
            existing !== null,
            progress,
          ),
        readText: () => selectedUploadText(selected),
        commit: async (ready, isCurrent) => {
          if (queuedComposerEdit !== null) {
            if (isCurrent())
              updateAttachments([
                ...latestAttachmentsRef.current.latest.filter(
                  (candidate) => candidate.id !== ready.id,
                ),
                ready,
              ]);
            return;
          }
          await upsertDraftAttachment?.(draftConnectionId, draftThreadId, ready, isCurrent);
        },
      });
      return true;
    };
    return stageAttachment;
  });
  const captureUploadAttachment = useEvent(() => {
    const { updateAttachments } = captureDraftMutations();
    const uploadSelectedAttachment = async (
      selected: SelectedUpload,
      onUploaded?: (attachment: StoredDraftAttachment) => void,
      offerRetry = true,
    ): Promise<StoredDraftAttachment | null> => {
      if (
        fileTransferController === null ||
        getTransferAccess === undefined ||
        draftThreadId === null
      )
        return null;
      let uploaded: StoredDraftAttachment | null = null;
      const commitUploaded =
        onUploaded ??
        ((attachment: StoredDraftAttachment) => {
          updateAttachments([
            ...latestAttachmentsRef.current.latest.filter(
              (candidate) => candidate.id !== attachment.id,
            ),
            attachment,
          ]);
        });
      const remotePath = attachmentUploadPath(draftThreadId, selected.name);
      try {
        await fileTransferController.start({
          scope: composerScope,
          mode: "upload",
          rootId: ATTACHMENT_ROOT_ID,
          remotePath,
          overwrite: false,
          upload: selected,
          directory: null,
          getAccess: getStableTransferAccess,
          onUploaded: (attachment) => {
            uploaded = attachment;
            commitUploaded(attachment);
          },
        });
        return uploaded;
      } catch (cause) {
        dialog.alert(
          "Could not attach file",
          cause instanceof Error ? cause.message : "File upload failed",
          offerRetry
            ? [
                { text: "Cancel", style: "cancel" },
                { text: "Retry", onPress: () => void uploadSelectedAttachment(selected) },
              ]
            : [{ text: "OK" }],
        );
        return null;
      }
    };
    return uploadSelectedAttachment;
  });
  const pickComposerAttachment = useEvent(async () => {
    const stageAttachment = captureStageAttachment();
    setComposerTrayVisible(false);
    if (!fileAttachmentEnabled) return;
    dismissComposerKeyboardForOverlay();
    const selected = await pickUploadFile().catch((cause): null => {
      dialog.alert(
        "Could not choose file",
        cause instanceof Error ? cause.message : "System file picker failed",
      );
      return null;
    });
    if (selected !== null) stageAttachment(selected);
  });
  return {
    fileAttachmentEnabled,
    captureStageAttachment,
    captureUploadAttachment,
    pickComposerAttachment,
  };
}

export function useDrawingAttachmentRead(
  composerUploadScope: string,
  latestAttachmentsRef: Parameters<typeof useAttachmentAdmission>[0]["latestAttachmentsRef"],
) {
  const readDrawingAttachments = useEvent((attachmentId: string | undefined) => {
    const uploading = composerUploads
      .entries(composerUploadScope)
      .find((entry) => entry.attachment.id === attachmentId);
    return uploading === undefined ? latestAttachmentsRef.current.latest : [uploading.attachment];
  });
  return { readDrawingAttachments };
}
