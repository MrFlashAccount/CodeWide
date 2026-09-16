import { toByteArray } from "base64-js";
import type { RemoteFileAttachment } from "@codewide/sync-client";

import type { QuickdrawDraftState, StoredDraftAttachment } from "./thread-ui-state-types";

export interface ImageDraftTarget {
  readonly attachmentId: string;
  readonly scope: string;
}

/** A stale preview must never turn a replacement into an attachment in another draft. */
export function imageAnnotationAttachment(
  target: ImageDraftTarget,
  scope: string,
  attachments: readonly StoredDraftAttachment[],
): StoredDraftAttachment {
  if (target.scope !== scope) {
    throw new Error("The image belongs to a different draft");
  }
  const attachment = attachments.find((item) => item.id === target.attachmentId);
  if (attachment === undefined) {
    throw new Error("The image is no longer attached to this draft");
  }
  return attachment;
}

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

export function quickdrawPngBytes(dataUrl: string): Uint8Array {
  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    throw new Error("QuickDraw did not return a PNG image");
  }
  const encoded = dataUrl.slice(PNG_DATA_URL_PREFIX.length).replaceAll(/\s/gu, "");
  if (encoded.length === 0) {
    throw new Error("QuickDraw returned an empty PNG image");
  }
  try {
    return toByteArray(encoded);
  } catch {
    throw new Error("QuickDraw returned an invalid PNG image");
  }
}

export function quickdrawAttachmentName(now = new Date()): string {
  return `drawing-${now.toISOString().replaceAll(/[:.]/gu, "-")}.png`;
}

export function isQuickdrawDraftAttachment(
  attachment: StoredDraftAttachment,
): attachment is StoredDraftAttachment & { editor: QuickdrawDraftState } {
  return attachment.editor?.kind === "quickdraw";
}

export function remoteAttachment(attachment: StoredDraftAttachment): RemoteFileAttachment {
  const { id, kind, name, path, rootId } = attachment;
  return { id, kind, name, path, rootId };
}
