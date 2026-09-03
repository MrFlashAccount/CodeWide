import type { ComposerAttachmentDraftItem } from "../../application/composer/composerAttachmentTypes";
import { parseQuickdrawImageSnapshot } from "../../application/drawing/quickdrawImage";
import type { DrawingWorkspaceRequest } from "./DrawingWorkspace";

export function drawingWorkspaceRequest(
  item: ComposerAttachmentDraftItem,
): DrawingWorkspaceRequest | null {
  const editor = item.editor;
  if (editor?.kind !== "quickdraw") return null;
  return {
    draftItemId: item.id,
    initialSnapshot: parseQuickdrawImageSnapshot(editor.snapshot),
    mode: editor.mode === "drawing" ? "drawing" : "image-annotation",
    name: item.name,
  };
}
