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
      ) {
        return false;
      }
      if (
        existing === null &&
        composerUploads.count(composerUploadScope, latestAttachmentsRef.current.latest) >=
          MAX_TURN_ATTACHMENTS
      ) {
        dialog.alert(
          "Too many attachments",
          `A message can contain at most ${String(MAX_TURN_ATTACHMENTS)} attachments.`,
        );
        return false;
      }
      const path = existing?.path ?? attachmentUploadPath(draftThreadId, selected.name);
      const attachment: StoredDraftAttachment = {
        id: existing?.id ?? randomUUID(),
        kind: fileMediaKind(selected.name, selected.mimeType) ?? "file",
        name: selected.name,
        path,
        rootId: existing?.rootId ?? ATTACHMENT_ROOT_ID,
        ...(editor === undefined ? {} : { editor }),
      };
      composerUploads.stage({
        attachment,
        commit: async (ready, isCurrent) => {
          if (queuedComposerEdit !== null) {
            if (isCurrent()) {
              updateAttachments([
                ...latestAttachmentsRef.current.latest.filter(
                  (candidate) => candidate.id !== ready.id,
                ),
                ready,
              ]);
            }
            return;
          }
          await upsertDraftAttachment?.(draftConnectionId, draftThreadId, ready, isCurrent);
        },
        preview: {
          bytes: selected.size,
          mimeType: selected.mimeType,
          text: null,
          uri: selectedUploadUri(selected),
        },
        readText: async () => selectedUploadText(selected),
        scope: composerUploadScope,
        start: (progress) =>
          startUpload(
            getTransferAccess,
            selected,
            attachment.rootId,
            path,
            existing !== null,
            progress,
          ),
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
      ) {
        return null;
      }
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
          directory: null,
          getAccess: getStableTransferAccess,
          mode: "upload",
          onUploaded: (attachment) => {
            uploaded = attachment;
            commitUploaded(attachment);
          },
          overwrite: false,
          remotePath,
          rootId: ATTACHMENT_ROOT_ID,
          scope: composerScope,
          upload: selected,
        });
        return uploaded;
      } catch (error) {
        dialog.alert(
          "Could not attach file",
          error instanceof Error ? error.message : "File upload failed",
          offerRetry
            ? [
                { style: "cancel", text: "Cancel" },
                { onPress: () => void uploadSelectedAttachment(selected), text: "Retry" },
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
    if (!fileAttachmentEnabled) {
      return;
    }
    dismissComposerKeyboardForOverlay();
    const selected = await pickUploadFile().catch((error: unknown): null => {
      dialog.alert(
        "Could not choose file",
        error instanceof Error ? error.message : "System file picker failed",
      );
      return null;
    });
    if (selected !== null) {
      stageAttachment(selected);
    }
  });
  return {
    captureStageAttachment,
    captureUploadAttachment,
    fileAttachmentEnabled,
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
