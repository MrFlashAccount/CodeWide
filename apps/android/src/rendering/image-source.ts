const MAX_INLINE_IMAGE_CHARS = 16 * 1024 * 1024;
const DATA_IMAGE_PATTERN = /^data:image\/(avif|gif|jpeg|png|webp);base64,([a-zA-Z0-9+/]+={0,2})$/u;
const RAW_BASE64_PATTERN = /^[a-zA-Z0-9+/]+={0,2}$/u;

export type InlineImagePayload = {
  base64: string;
  extension: "avif" | "gif" | "jpg" | "png" | "webp";
};

export type PrivateImageAssetProjection = {
  byteLength: number;
  contentType: string;
  id: string;
};

export type UserImageSourceProjection =
  | { asset: PrivateImageAssetProjection; kind: "content" }
  | { kind: "uri"; uri: string }
  | { kind: "path"; path: string };

export function safeImageUri(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_INLINE_IMAGE_CHARS) {
    return null;
  }
  if (isSafeHttpImageUrl(value)) {
    return value;
  }
  if (DATA_IMAGE_PATTERN.test(value)) {
    return value;
  }
  const mimeType = rawImageMimeType(value);
  return mimeType === null ? null : `data:${mimeType};base64,${value}`;
}

export function inlineImagePayload(value: string): InlineImagePayload | null {
  const dataMatch = DATA_IMAGE_PATTERN.exec(value);
  if (dataMatch !== null) {
    const mime = dataMatch[1];
    const base64 = dataMatch[2];
    if (mime === undefined || base64 === undefined) {
      return null;
    }
    const extension = imageExtension(`image/${mime}`);
    return extension === null ? null : { base64, extension };
  }
  const mimeType = rawImageMimeType(value);
  if (mimeType === null) {
    return null;
  }
  const extension = imageExtension(mimeType);
  return extension === null ? null : { base64: value, extension };
}

/** Validate the private content marker used when inline image bytes are
 * removed from the sync lane. */
export function privateImageAssetProjection(value: unknown): PrivateImageAssetProjection | null {
  const asset = unknownRecord(value);
  if (asset === null) {
    return null;
  }
  return asset.version === 1 &&
    typeof asset.id === "string" &&
    /^[a-f0-9]{64}$/u.test(asset.id) &&
    typeof asset.byteLength === "number" &&
    Number.isSafeInteger(asset.byteLength) &&
    asset.byteLength > 0 &&
    typeof asset.contentType === "string" &&
    asset.contentType.startsWith("image/")
    ? { byteLength: asset.byteLength, contentType: asset.contentType, id: asset.id }
    : null;
}

export function userImageSourceProjection(value: unknown): UserImageSourceProjection | null {
  const part = unknownRecord(value);
  if (part === null) {
    return null;
  }
  if (part.type === "image") {
    const asset = privateImageAssetProjection(part.codewideAsset);
    if (asset !== null) {
      return { asset, kind: "content" };
    }
    const uri = safeImageUri(part.url);
    return uri === null ? null : { kind: "uri", uri };
  }
  return part.type === "localImage" && typeof part.path === "string" && part.path.length > 0
    ? { kind: "path", path: part.path }
    : null;
}

function imageExtension(mimeType: string): InlineImagePayload["extension"] | null {
  switch (mimeType) {
    case "image/avif":
      return "avif";
    case "image/gif":
      return "gif";
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}

function isSafeHttpImageUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function rawImageMimeType(value: string): string | null {
  if (!RAW_BASE64_PATTERN.test(value)) {
    return null;
  }
  if (value.startsWith("iVBORw0KGgo")) {
    return "image/png";
  }
  if (value.startsWith("/9j/")) {
    return "image/jpeg";
  }
  if (value.startsWith("R0lGOD")) {
    return "image/gif";
  }
  if (value.startsWith("UklGR")) {
    return "image/webp";
  }
  return null;
}
import { unknownRecord } from "../data/unknownRecord";
