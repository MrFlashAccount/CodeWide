import type { SavedServerId, ThreadId } from "../../domain/ids";

export type ComposerAttachmentPickKind = "file" | "image";

export interface LocalComposerAttachment {
  handle: string;
  mediaType: string;
  name: string;
  sizeBytes: number;
}

export interface PersistedLocalComposerAttachment {
  mediaType: string;
  name: string;
  sizeBytes: number;
  token: string;
}

interface ComposerAttachmentUploadProgress {
  phase: "hashing" | "uploading" | "verifying";
  totalBytes: number;
  transferredBytes: number;
}

interface ComposerAttachmentUploadResult {
  attachmentId: string;
  discard(): Promise<void>;
}

export interface ComposerAttachmentUploadInput {
  attachment: LocalComposerAttachment;
  onProgress(progress: ComposerAttachmentUploadProgress): void;
  savedServerId: SavedServerId;
  target: ComposerAttachmentTarget;
}

export interface ComposerAttachmentTarget {
  threadId: ThreadId | null;
  workspace: string | null;
}

export interface RunningComposerAttachmentUpload {
  cancel(): void;
  promise: Promise<ComposerAttachmentUploadResult>;
}

/** Owns platform files and transfers without exposing native handles to application state. */
export interface ComposerAttachmentTransport {
  createBytes(name: string, mediaType: string, value: Uint8Array): LocalComposerAttachment;
  createText(name: string, mediaType: string, value: string): LocalComposerAttachment;
  pick(kind: ComposerAttachmentPickKind): Promise<LocalComposerAttachment | null>;
  reference(attachment: LocalComposerAttachment): PersistedLocalComposerAttachment;
  release(attachment: LocalComposerAttachment): void;
  restore(reference: PersistedLocalComposerAttachment): LocalComposerAttachment | null;
  upload(input: ComposerAttachmentUploadInput): RunningComposerAttachmentUpload;
}
