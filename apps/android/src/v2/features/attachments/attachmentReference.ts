import type { V2Attachment } from "@codewide/sync-client/v2";

import type { RenderingImageItem } from "../../rendering/renderingCapabilities";

export function attachmentForImageItem(
  attachments: readonly V2Attachment[],
  item: RenderingImageItem,
): V2Attachment | null {
  return (
    attachmentForReference(attachments, item.reference) ??
    (item.link === undefined ? null : attachmentForReference(attachments, item.link))
  );
}

export function attachmentForReference(
  attachments: readonly V2Attachment[],
  reference: string,
): V2Attachment | null {
  const normalized = normalizedReference(reference);
  const exact = attachments.find((attachment) => {
    if (attachment.downloadUrl === reference.trim()) return true;
    const attachmentPath =
      attachment.downloadUrl === null ? null : previewPath(attachment.downloadUrl);
    return attachment.name === normalized || attachmentPath === normalized;
  });
  if (exact !== undefined) return exact;
  const basename = pathBasename(normalized);
  const basenameMatches = attachments.filter((attachment) => {
    const attachmentPath =
      attachment.downloadUrl === null ? null : previewPath(attachment.downloadUrl);
    return (
      pathBasename(attachment.name) === basename ||
      (attachmentPath !== null && pathBasename(attachmentPath) === basename)
    );
  });
  return basenameMatches.length === 1 ? (basenameMatches[0] ?? null) : null;
}

function pathBasename(value: string): string {
  return value.split("/").at(-1) ?? value;
}

function normalizedReference(reference: string): string {
  const trimmed = reference.trim();
  return previewPath(trimmed) ?? trimmed.replace(/^\.\//u, "").split(/[?#]/u, 1)[0] ?? trimmed;
}

function previewPath(reference: string): string | null {
  if (!reference.startsWith("/v2/files/preview?")) return null;
  try {
    return new URL(reference, "https://codewide.invalid").searchParams.get("path");
  } catch {
    return null;
  }
}
