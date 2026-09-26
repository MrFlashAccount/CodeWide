import { imageDataUrl } from "../../../data/quickdraw-image";
import type { GetTransferAccess, PrivateAssetSource } from "../../../data/private-transfer";
import { checkAborted } from "../../../native/check-aborted";
import { readReviewImageBytes } from "./reviewImageBytes";

const MAX_INLINE_REVIEW_IMAGE_BYTES = Number("2097152");

/** Materialize a bounded image preview before passing it into the isolated editor WebView. */
export async function loadReviewImage(
  source: PrivateAssetSource,
  getTransferAccess: GetTransferAccess,
  signal: AbortSignal,
): Promise<string> {
  const { materializePrivateAsset } = await import("../../../rendering/private-asset");
  const preview = await materializePrivateAsset(source, {
    getAccess: getTransferAccess,
    signal,
    variant: "preview",
  });
  checkAborted(signal);
  const { bytes, contentType } = await readReviewImageBytes(preview.uri, signal);
  checkAborted(signal);
  if (bytes.length > MAX_INLINE_REVIEW_IMAGE_BYTES) {
    throw new Error("Image preview is too large to display inline");
  }
  return imageDataUrl(bytes, contentType, preview.uri);
}
