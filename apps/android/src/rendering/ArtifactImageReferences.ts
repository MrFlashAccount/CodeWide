import { createContext } from "react";
import type { UserMessageAttachment } from "./user-message-attachments";

/** Images promoted to the bubble gallery must not also mount inline previews. */
export const ArtifactImageReferences = createContext<ReadonlySet<string> | null>(null);

export function artifactImageReferences(
  attachments: readonly UserMessageAttachment[],
): ReadonlySet<string> {
  const references = new Set<string>();
  for (const attachment of attachments) {
    if (attachment.kind !== "image") {
      continue;
    }
    if (attachment.source.type === "path") {
      references.add(attachment.source.path);
      references.add(`sandbox:${attachment.source.path}`);
    } else if (attachment.source.type === "url") {
      references.add(attachment.source.url);
    } else if (attachment.source.type === "content") {
      references.add(`content:${attachment.source.asset.id}`);
    }
  }
  return references;
}
