import { ATTACHMENT_ROOT_ID, attachmentUploadPath } from "../../data/attachment-upload";
import { quickdrawAttachmentName, quickdrawPngBytes } from "../../data/quickdraw-attachment";
import type { StoredDraftAttachment } from "../../data/thread-ui-state-types";
import { createBinaryUpload, type SelectedUpload } from "../../native/file-transfer";
import type { DrawingCommit } from "./DrawingWorkspace";

/** Captured admission belongs to the composer activation that opened this drawing. */
export type DrawingAdmission = {
  available: boolean;
  draftThreadId: string | null;
  stageAttachment: (
    selected: SelectedUpload,
    existing: StoredDraftAttachment | null,
    editor: StoredDraftAttachment["editor"],
  ) => boolean;
};

export async function commitDrawing(
  admission: DrawingAdmission,
  existing: StoredDraftAttachment | null,
  mode: "drawing" | "image-annotation",
  name: string | null,
  value: DrawingCommit,
): Promise<boolean> {
  await Promise.resolve();
  const { available, draftThreadId, stageAttachment } = admission;
  if (!available || draftThreadId === null) {
    return false;
  }
  const selected = createBinaryUpload(
    name ?? existing?.name ?? quickdrawAttachmentName(),
    "image/png",
    quickdrawPngBytes(value.pngDataUrl),
  );
  // PNG annotation of a JPEG gets a PNG destination, but keeps the draft card identity.
  const replacement =
    existing !== null && existing.name !== selected.name
      ? {
          ...existing,
          name: selected.name,
          path: attachmentUploadPath(draftThreadId, selected.name),
          rootId: ATTACHMENT_ROOT_ID,
        }
      : existing;
  return stageAttachment(selected, replacement, {
    kind: "quickdraw",
    mode,
    revision: Date.now(),
    snapshot: value.snapshot,
  });
}
