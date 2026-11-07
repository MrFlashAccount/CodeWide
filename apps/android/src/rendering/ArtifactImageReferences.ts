import { createContext } from "react";
import type { UserMessageAttachment } from "./user-message-attachments";

/** Images promoted to the bubble gallery must not also mount inline previews. */
export const ArtifactImageReferences = createContext<ReadonlySet<string> | null>(null);

const referenceCache = new WeakMap<readonly UserMessageAttachment[], ReadonlySet<string>>();
const previewOrderByReferences = new WeakMap<ReadonlySet<string>, ReadonlyMap<string, number>>();

export function artifactImageReferences(
  attachments: readonly UserMessageAttachment[],
): ReadonlySet<string> {
  const cached = referenceCache.get(attachments);
  if (cached !== undefined) {
    return cached;
  }
  const references = new Set<string>();
  const previewOrder = new Map<string, number>();
  let imageIndex = 0;
  for (const attachment of attachments) {
    if (attachment.kind !== "image") {
      continue;
    }
    if (attachment.source.type === "path") {
      references.add(attachment.source.path);
      references.add(`sandbox:${attachment.source.path}`);
      previewOrder.set(attachment.source.path, imageIndex);
      previewOrder.set(`sandbox:${attachment.source.path}`, imageIndex);
    } else if (attachment.source.type === "url") {
      references.add(attachment.source.url);
      previewOrder.set(attachment.source.url, imageIndex);
    } else if (attachment.source.type === "content") {
      references.add(`content:${attachment.source.asset.id}`);
      previewOrder.set(`content:${attachment.source.asset.id}`, imageIndex);
    }
    imageIndex += 1;
  }
  referenceCache.set(attachments, references);
  previewOrderByReferences.set(references, previewOrder);
  return references;
}

export function artifactImagePreviewOrder(
  references: ReadonlySet<string> | null,
  reference: string,
): number | undefined {
  return references === null ? undefined : previewOrderByReferences.get(references)?.get(reference);
}
