import { MAX_TURN_ATTACHMENTS } from "@codewide/sync-client";
import { composerUploads } from "../../../data/composer-uploads";
import type { SelectedUpload } from "../../../native/file-transfer";
import {
  capturePhotoUpload,
  openCameraPermissionSettings,
  pickPhotoUploads,
} from "../../../native/photoCapture";
import type { CameraCapture } from "../../../native/photoCaptureContract";
import { appLogger } from "../../../observability/logger";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../../ui/AppDialog";
import type { AttachmentAdmissionCapabilities } from "./attachmentCapabilities";

type AppDialog = ReturnType<typeof useAppDialog>;
type StageAttachment = (selected: SelectedUpload) => boolean;
type PhotoAcquisition = {
  readonly acquire: (limit: number) => Promise<CameraCapture>;
  readonly failureEvent: string;
  readonly failureTitle: string;
};

const PHOTO_LIBRARY: PhotoAcquisition = {
  acquire: pickPhotoUploads,
  failureEvent: "composer.photo_picker.failed",
  failureTitle: "Could not add photo",
};
const CAMERA: PhotoAcquisition = {
  acquire: capturePhotoUpload,
  failureEvent: "composer.camera_capture.failed",
  failureTitle: "Could not take photo",
};

/** Admits system Photo Picker and camera photos through the draft's ordinary file admission. */
export function usePhotoAdmission({
  captureStageAttachment,
  composerSession,
  composerUploadScope,
  dismissComposerKeyboardForOverlay,
  fileAttachmentEnabled,
  setComposerTrayVisible,
}: Pick<
  AttachmentAdmissionCapabilities,
  | "composerSession"
  | "composerUploadScope"
  | "dismissComposerKeyboardForOverlay"
  | "setComposerTrayVisible"
> & {
  readonly captureStageAttachment: () => StageAttachment;
  readonly fileAttachmentEnabled: boolean;
}): {
  readonly pickComposerPhotos: () => Promise<void>;
  readonly takeComposerPhoto: () => Promise<void>;
} {
  const dialog = useAppDialog();
  const admitPhotos = useEvent(async (acquisition: PhotoAcquisition) => {
    const stageAttachment = captureStageAttachment();
    setComposerTrayVisible(false);
    if (!fileAttachmentEnabled) {
      return;
    }
    dismissComposerKeyboardForOverlay();
    const remaining =
      MAX_TURN_ATTACHMENTS -
      composerUploads.count(composerUploadScope, composerSession.read().attachments);
    const capture = await acquisition.acquire(remaining).catch((error: unknown) => {
      appLogger.errorCaught({ error, event: acquisition.failureEvent });
      dialog.error(acquisition.failureTitle, error);
      return null;
    });
    if (capture !== null) {
      settleCapture(capture, stageAttachment, dialog);
    }
  });
  const pickComposerPhotos = useEvent(async () => admitPhotos(PHOTO_LIBRARY));
  const takeComposerPhoto = useEvent(async () => admitPhotos(CAMERA));
  return { pickComposerPhotos, takeComposerPhoto };
}

function settleCapture(
  capture: CameraCapture,
  stageAttachment: StageAttachment,
  dialog: AppDialog,
): void {
  if (capture.status === "permission-denied") {
    showCameraPermissionNotice(dialog, capture.canAskAgain);
    return;
  }
  if (capture.status === "selected") {
    // Staging stops at the first rejection so the attachment limit is reported once.
    capture.uploads.every((upload) => stageAttachment(upload));
  }
}

function showCameraPermissionNotice(dialog: AppDialog, canAskAgain: boolean): void {
  if (canAskAgain) {
    dialog.alert("Camera access needed", "Allow CodeWide to use the camera to take a photo.");
    return;
  }
  dialog.alert(
    "Camera access needed",
    "Camera access is turned off for CodeWide. Allow it in Android settings to take a photo.",
    [
      { style: "cancel", text: "Cancel" },
      {
        onPress: () => {
          openCameraPermissionSettings().catch((error: unknown) => {
            appLogger.errorCaught({ error, event: "composer.camera_settings.failed" });
            dialog.error("Could not open settings", error);
          });
        },
        text: "Open settings",
      },
    ],
  );
}
