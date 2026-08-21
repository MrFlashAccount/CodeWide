import type { RemoteFileAttachment } from "@codewide/sync-client";

import type { PrivateAssetSource } from "../data/private-transfer";
import { remoteFileKind, type DocumentPreviewKind } from "./document-preview";

/**
 * Draft and queued attachments already live in a companion-scoped root after
 * upload. Keep that reference intact all the way into the shared preview
 * hosts; treating the relative path as a workspace path would address a
 * different file and eventually produce a 404.
 */
export function composerAttachmentSource(attachment: RemoteFileAttachment): PrivateAssetSource {
  return { kind: "scoped", rootId: attachment.rootId, path: attachment.path };
}

export function composerAttachmentPreviewKind(attachment: RemoteFileAttachment): DocumentPreviewKind {
  if (attachment.kind === "image") return "image";
  return remoteFileKind(attachment.name, attachment.path);
}
