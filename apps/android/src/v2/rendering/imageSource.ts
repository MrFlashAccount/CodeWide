const MAX_INLINE_IMAGE_CHARS = 16 * 1024 * 1024;
const DATA_IMAGE_PATTERN = /^data:image\/(avif|gif|jpeg|png|webp);base64,[a-zA-Z0-9+/]+={0,2}$/u;
const RAW_BASE64_PATTERN = /^[a-zA-Z0-9+/]+={0,2}$/u;

export function safeMarkdownImageUri(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_INLINE_IMAGE_CHARS) {
    return null;
  }
  if (isSafeHttpsUrl(value) || DATA_IMAGE_PATTERN.test(value)) return value;
  const mimeType = rawImageMimeType(value);
  return mimeType === null ? null : `data:${mimeType};base64,${value}`;
}

function isSafeHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:" && !isLoopbackHttpUrl(value);
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
import { isLoopbackHttpUrl } from "./linkClassification";
