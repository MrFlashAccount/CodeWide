import type { V2InputBlock } from "@codewide/sync-client/v2";

import type { ComposerAttachmentTarget } from "../ports/composerAttachmentTransport";

type ComposerAttachmentState = "selected" | "uploading" | "ready" | "error";

export interface ComposerAttachmentEditorMetadata {
  kind: "quickdraw";
  mode: "drawing" | "imageAnnotation";
  revision: number;
  snapshot: string;
}

export interface ComposerAttachmentDraftItem {
  editor: ComposerAttachmentEditorMetadata | null;
  error: string | null;
  id: string;
  mediaType: string;
  name: string;
  progress: number | null;
  sizeBytes: number;
  state: ComposerAttachmentState;
}

export interface ComposerAttachmentDraftSnapshot {
  items: readonly ComposerAttachmentDraftItem[];
}

export interface ComposerSubmission {
  prepareInput(target: ComposerAttachmentTarget): Promise<V2InputBlock[]>;
  text: string;
}

export interface LargePasteCapture {
  attachmentText: string;
  draftText: string;
  insertionOffset: number;
  pastedDraftText: string;
}

export interface LargePasteEvent {
  end: number;
  start: number;
  text: string;
}
