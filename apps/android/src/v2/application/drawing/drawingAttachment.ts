import { toByteArray } from "base64-js";

import type { ComposerAttachmentDraft } from "../composer/composerAttachmentDraft";
import type { ComposerAttachmentEditorMetadata } from "../composer/composerAttachmentTypes";

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

export interface CommitDrawingInput {
  draftItemId: string | null;
  mode: "drawing" | "image-annotation";
  name: string;
  pngDataUrl: string;
  revision: number;
  snapshot: unknown;
}

/** Converts a QuickDraw export at the application boundary and commits it as a draft attachment. */
export async function commitDrawingAttachment(
  draft: Pick<ComposerAttachmentDraft, "attachBytes" | "replaceBytes">,
  input: CommitDrawingInput,
): Promise<string> {
  const bytes = quickdrawPngBytes(input.pngDataUrl);
  const snapshot = JSON.stringify(input.snapshot);
  if (snapshot === undefined) throw new Error("QuickDraw returned an invalid drawing snapshot");
  const editor: ComposerAttachmentEditorMetadata = {
    kind: "quickdraw",
    mode: input.mode === "drawing" ? "drawing" : "imageAnnotation",
    revision: input.revision,
    snapshot,
  };
  if (input.draftItemId === null) {
    return draft.attachBytes(input.name, "image/png", bytes, editor);
  }
  await draft.replaceBytes(input.draftItemId, input.name, "image/png", bytes, editor);
  return input.draftItemId;
}

export function quickdrawPngBytes(dataUrl: string): Uint8Array {
  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    throw new Error("QuickDraw did not return a PNG image");
  }
  const encoded = dataUrl.slice(PNG_DATA_URL_PREFIX.length).replaceAll(/\s/gu, "");
  if (encoded.length === 0) throw new Error("QuickDraw returned an empty PNG image");
  try {
    return toByteArray(encoded);
  } catch {
    throw new Error("QuickDraw returned an invalid PNG image");
  }
}

export function quickdrawAttachmentName(now: Date): string {
  return `drawing-${now.toISOString().replaceAll(/[:.]/gu, "-")}.png`;
}
