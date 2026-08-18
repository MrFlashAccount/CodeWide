const MAX_INLINE_IMAGE_CHARS = 16 * 1024 * 1024;
const DATA_IMAGE_PATTERN = /^data:image\/(avif|gif|jpeg|png|webp);base64,([a-zA-Z0-9+/]+={0,2})$/u;
const RAW_BASE64_PATTERN = /^[a-zA-Z0-9+/]+={0,2}$/u;

export type InlineImagePayload = {
  base64: string;
  extension: "avif" | "gif" | "jpg" | "png" | "webp";
};

export type PrivateImageAssetProjection = {
  id: string;
  byteLength: number;
  contentType: string;
};

export type UserImageSourceProjection =
  | { kind: "content"; asset: PrivateImageAssetProjection }
  | { kind: "uri"; uri: string }
  | { kind: "path"; path: string };

export function safeImageUri(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_INLINE_IMAGE_CHARS) return null;
  if (isSafeHttpImageUrl(value)) return value;
  if (DATA_IMAGE_PATTERN.test(value)) return value;
  const mimeType = rawImageMimeType(value);
  return mimeType === null ? null : `data:${mimeType};base64,${value}`;
}

export function inlineImagePayload(value: string): InlineImagePayload | null {
  const dataMatch = DATA_IMAGE_PATTERN.exec(value);
  if (dataMatch !== null) {
    const mime = dataMatch[1];
    const base64 = dataMatch[2];
    if (mime === undefined || base64 === undefined) return null;
    return { base64, extension: (mime === "jpeg" ? "jpg" : mime) as InlineImagePayload["extension"] };
  }
  const mimeType = rawImageMimeType(value);
  if (mimeType === null) return null;
  return { base64: value, extension: mimeType === "image/jpeg" ? "jpg" : mimeType.slice("image/".length) as InlineImagePayload["extension"] };
}

/** Validate the private content marker used when inline image bytes are
 * removed from the sync lane. */
export function privateImageAssetProjection(value: unknown): PrivateImageAssetProjection | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const asset = value as Record<string, unknown>;
  return asset.version === 1
    && typeof asset.id === "string"
    && /^[a-f0-9]{64}$/u.test(asset.id)
    && typeof asset.byteLength === "number"
    && Number.isSafeInteger(asset.byteLength)
    && asset.byteLength > 0
    && typeof asset.contentType === "string"
    && asset.contentType.startsWith("image/")
    ? { id: asset.id, byteLength: asset.byteLength, contentType: asset.contentType }
    : null;
}

export function userImageSourceProjection(value: unknown): UserImageSourceProjection | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const part = value as Record<string, unknown>;
  if (part.type === "image") {
    const asset = privateImageAssetProjection(part.codewideAsset);
    if (asset !== null) return { kind: "content", asset };
    const uri = safeImageUri(part.url);
    return uri === null ? null : { kind: "uri", uri };
  }
  return part.type === "localImage" && typeof part.path === "string" && part.path.length > 0
    ? { kind: "path", path: part.path }
    : null;
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
  if (!RAW_BASE64_PATTERN.test(value)) return null;
  if (value.startsWith("iVBORw0KGgo")) return "image/png";
  if (value.startsWith("/9j/")) return "image/jpeg";
  if (value.startsWith("R0lGOD")) return "image/gif";
  if (value.startsWith("UklGR")) return "image/webp";
  return null;
}
