import { toByteArray } from "base64-js";
import type { V2Attachment } from "@codewide/sync-client/v2";

import {
  MAX_DOCUMENT_PREVIEW_BYTES,
  type PreviewDocument,
  type PreviewMode,
} from "../../application/preview/previewTransport";
import { isVideoAttachment } from "./videoPreview";

/** @testOnly Exposes the production preview ceiling to its truncation boundary regression. */
export { MAX_DOCUMENT_PREVIEW_BYTES } from "../../application/preview/previewTransport";

const IMAGE_EXTENSIONS = new Set(["avif", "gif", "heic", "heif", "jpeg", "jpg", "png", "webp"]);
const MARKDOWN_EXTENSIONS = new Set(["md", "mdx"]);
const TEXT_EXTENSIONS = new Set([
  "c",
  "cpp",
  "css",
  "go",
  "h",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "log",
  "py",
  "rs",
  "sh",
  "swift",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

interface DecodedPreviewDocument {
  source: string;
  truncated: boolean;
}

export type PreviewDocumentResult =
  | { document: DecodedPreviewDocument; ok: true }
  | { message: string; ok: false };

export function attachmentPreviewMode(attachment: V2Attachment): PreviewMode {
  if (isTextAttachment(attachment)) return "document";
  if (isVideoAttachment(attachment.name, attachment.mediaType)) return "video";
  if (isImageAttachment(attachment)) return "image";
  return "web";
}

export function isHtmlAttachment(attachment: V2Attachment): boolean {
  const mediaType = normalizedMediaType(attachment.mediaType);
  return mediaType === "text/html" || extension(attachment.name) === "html";
}

export function isImageAttachment(attachment: V2Attachment): boolean {
  const mediaType = normalizedMediaType(attachment.mediaType);
  return mediaType.startsWith("image/") || IMAGE_EXTENSIONS.has(extension(attachment.name));
}

export function isMarkdownAttachment(attachment: V2Attachment): boolean {
  return (
    normalizedMediaType(attachment.mediaType).includes("markdown") ||
    MARKDOWN_EXTENSIONS.has(extension(attachment.name))
  );
}

export function decodePreviewDocument(document: PreviewDocument): PreviewDocumentResult {
  try {
    const probeBase64Length = Math.ceil((MAX_DOCUMENT_PREVIEW_BYTES + 1) / 3) * 4;
    const encoded = document.bodyBase64.slice(0, probeBase64Length);
    const decoded = toByteArray(encoded);
    const truncated =
      document.bodyBase64.length > probeBase64Length ||
      decoded.byteLength > MAX_DOCUMENT_PREVIEW_BYTES;
    const bytes = decoded.subarray(0, MAX_DOCUMENT_PREVIEW_BYTES);
    return {
      document: {
        source: new TextDecoder().decode(bytes),
        truncated,
      },
      ok: true,
    };
  } catch {
    return { message: "This attachment contains invalid document data.", ok: false };
  }
}

function isTextAttachment(attachment: V2Attachment): boolean {
  const mediaType = normalizedMediaType(attachment.mediaType);
  return (
    isMarkdownAttachment(attachment) ||
    mediaType.startsWith("text/") ||
    TEXT_EXTENSIONS.has(extension(attachment.name))
  );
}

function normalizedMediaType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function extension(name: string): string {
  return name.split(/[?#]/u, 1)[0]?.split(".").at(-1)?.toLowerCase() ?? "";
}
