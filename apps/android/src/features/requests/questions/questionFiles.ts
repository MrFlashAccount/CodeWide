import type { RemoteFileAttachment } from "@codewide/sync-client";
import { unknownRecord } from "../../../data/unknownRecord";

function fileReference(value: unknown): RemoteFileAttachment | null {
  const file = unknownRecord(value);
  if (
    file === null ||
    typeof file.id !== "string" ||
    typeof file.name !== "string" ||
    typeof file.rootId !== "string" ||
    typeof file.path !== "string"
  ) {
    return null;
  }
  const kind = file.kind;
  if (!attachmentKind(kind)) {
    return null;
  }
  return { id: file.id, kind, name: file.name, path: file.path, rootId: file.rootId };
}
/** Restores only scoped file references admitted by the regular composer. */
export function readQuestionFiles(stored: unknown): { attachments?: RemoteFileAttachment[] } {
  if (!Array.isArray(stored)) {
    return {};
  }
  const attachments: RemoteFileAttachment[] = [];
  for (const candidate of stored) {
    const file = fileReference(candidate);
    if (file !== null) {
      attachments.push(file);
    }
  }
  return attachments.length > 0 ? { attachments } : {};
}

function attachmentKind(kind: unknown): kind is RemoteFileAttachment["kind"] {
  return kind === "image" || kind === "file" || kind === "audio";
}
