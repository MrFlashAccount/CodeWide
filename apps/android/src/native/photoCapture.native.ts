import {
  launchCameraAsync,
  launchImageLibraryAsync,
  requestCameraPermissionsAsync,
  type ImagePickerAsset,
  type ImagePickerOptions,
  type ImagePickerResult,
} from "expo-image-picker";
import { File } from "expo-file-system";
import { Linking } from "react-native";
import type { SelectedUpload } from "./file-transfer";
import type { CameraCapture, PhotoSelection } from "./photoCaptureContract";

type PhotoSource = "camera" | "photo";

const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Original bytes and no EXIF payload in the result: the attachment upload owns size handling.
const PICKER_OPTIONS: ImagePickerOptions = { exif: false, mediaTypes: "images", quality: 1 };

/** Opens the Android Photo Picker, which needs no storage permission, for up to `limit` images. */
export async function pickPhotoUploads(limit: number): Promise<PhotoSelection> {
  const options: ImagePickerOptions = {
    ...PICKER_OPTIONS,
    allowsMultipleSelection: limit > 1,
    selectionLimit: Math.max(1, limit),
  };
  return photoSelection(await launchImageLibraryAsync(options), "photo");
}

/** Opens the system camera app after the camera permission the app manifest declares is granted. */
export async function capturePhotoUpload(): Promise<CameraCapture> {
  const permission = await requestCameraPermissionsAsync();
  if (!permission.granted) {
    return { canAskAgain: permission.canAskAgain, status: "permission-denied" };
  }
  return photoSelection(await launchCameraAsync(PICKER_OPTIONS), "camera");
}

/** Opens this app's system settings so a permanently denied camera permission can be granted. */
export async function openCameraPermissionSettings(): Promise<void> {
  await Linking.openSettings();
}

function photoSelection(result: ImagePickerResult, source: PhotoSource): PhotoSelection {
  if (result.canceled) {
    return { status: "cancelled" };
  }
  const fallbackPrefix = `${source}-${String(Date.now())}`;
  return {
    status: "selected",
    uploads: result.assets.map((asset, index) =>
      photoUpload(asset, `${fallbackPrefix}-${String(index)}`),
    ),
  };
}

/** Converts a picker DTO into the upload contract; the cached file, not the DTO, supplies size. */
function photoUpload(asset: ImagePickerAsset, fallbackStem: string): SelectedUpload {
  if (asset.uri === "") {
    throw new Error("The selected photo has no readable file");
  }
  const native = new File(asset.uri);
  if (!native.exists) {
    throw new Error("The selected photo is no longer available");
  }
  const mimeType = photoMimeType(asset.mimeType);
  return {
    mimeType,
    name: photoName(asset.fileName, mimeType, fallbackStem),
    native,
    size: native.size,
  };
}

function photoMimeType(reported: string | undefined): string {
  return reported?.startsWith("image/") === true ? reported : "image/jpeg";
}

function photoName(
  reported: string | null | undefined,
  mimeType: string,
  fallbackStem: string,
): string {
  const picked = reported?.trim() ?? "";
  return picked === "" ? `${fallbackStem}.${IMAGE_EXTENSIONS[mimeType] ?? "jpg"}` : picked;
}
