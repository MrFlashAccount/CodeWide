import type { CameraCapture, PhotoSelection } from "./photoCaptureContract";

/** Web has no attachment upload transport; the composer disables the action there. */
export async function pickPhotoUploads(_limit: number): Promise<PhotoSelection> {
  await Promise.resolve();
  throw new Error("Photo attachments are available in the Android build");
}

/** Web has no attachment upload transport; the composer disables the action there. */
export async function capturePhotoUpload(): Promise<CameraCapture> {
  await Promise.resolve();
  throw new Error("Camera attachments are available in the Android build");
}

/** Web has no app settings screen to open. */
export async function openCameraPermissionSettings(): Promise<void> {
  await Promise.resolve();
}
