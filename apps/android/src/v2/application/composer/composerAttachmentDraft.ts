import type { V2InputBlock } from "@codewide/sync-client/v2";

import type { SavedServerId } from "../../domain/ids";
import type {
  ComposerAttachmentTarget,
  ComposerAttachmentTransport,
  LocalComposerAttachment,
  RunningComposerAttachmentUpload,
} from "../ports/composerAttachmentTransport";
import type { PersistedComposerDraftAttachment } from "../ports/composerDraftStore";
import { ObservableResource } from "../resources/resource";
import type {
  ComposerAttachmentDraftItem,
  ComposerAttachmentDraftSnapshot,
  ComposerAttachmentEditorMetadata,
} from "./composerAttachmentTypes";

interface ComposerAttachmentDraftInput {
  initialAttachments?: readonly PersistedComposerDraftAttachment[];
  now(): number;
  onChange?(attachments: PersistedComposerDraftAttachment[]): void;
  savedServerId: SavedServerId;
  target: ComposerAttachmentTarget;
  transport: ComposerAttachmentTransport;
}

interface DraftEntry {
  attachment: LocalComposerAttachment;
  editor: ComposerAttachmentEditorMetadata | null;
  error: string | null;
  id: string;
  progress: number | null;
  remoteDiscard: (() => Promise<void>) | null;
  remoteId: string | null;
  running: RunningComposerAttachmentUpload | null;
  state: ComposerAttachmentDraftItem["state"];
}

/** Owns picker selections and upload operations for one composer draft. */
export class ComposerAttachmentDraft extends ObservableResource<ComposerAttachmentDraftSnapshot> {
  readonly #entries: DraftEntry[] = [];
  readonly #now: () => number;
  readonly #savedServerId: SavedServerId;
  readonly #transport: ComposerAttachmentTransport;
  readonly #onChange: ((attachments: PersistedComposerDraftAttachment[]) => void) | null;
  #target: ComposerAttachmentTarget;

  constructor(input: ComposerAttachmentDraftInput) {
    super({ items: [] });
    this.#now = input.now;
    this.#savedServerId = input.savedServerId;
    this.#target = input.target;
    this.#transport = input.transport;
    this.#onChange = input.onChange ?? null;
    this.restore(input.initialAttachments ?? [], false);
  }

  restore(attachments: readonly PersistedComposerDraftAttachment[], notify = true): void {
    if (this.#entries.length > 0) return;
    let rejectedReference = false;
    for (const persisted of attachments) {
      let attachment: LocalComposerAttachment | null = null;
      try {
        attachment = this.#transport.restore(persisted.local);
      } catch {
        // A corrupt or externally deleted draft file is purged by the next persisted snapshot.
      }
      if (attachment === null) {
        rejectedReference = true;
        continue;
      }
      this.#entries.push({
        attachment,
        editor: persisted.editor,
        error: persisted.error,
        id: attachment.handle,
        progress: persisted.state === "ready" ? 1 : null,
        remoteDiscard: null,
        remoteId: persisted.remoteId,
        running: null,
        state: persisted.state,
      });
    }
    this.publishCurrent(notify || rejectedReference);
  }

  setTarget(target: ComposerAttachmentTarget): void {
    if (this.#target.threadId !== null && this.#target.threadId !== target.threadId) {
      throw new Error("Composer draft cannot move between threads");
    }
    this.#target = target;
  }

  async pickFile(): Promise<void> {
    await this.pick("file");
  }

  async pickImage(): Promise<void> {
    await this.pick("image");
  }

  async attachText(name: string, mediaType: string, value: string): Promise<string> {
    return this.add(this.#transport.createText(name, mediaType, value), null);
  }

  async attachBytes(
    name: string,
    mediaType: string,
    value: Uint8Array,
    editor: ComposerAttachmentEditorMetadata | null = null,
  ): Promise<string> {
    return this.add(this.#transport.createBytes(name, mediaType, value), editor);
  }

  async attachPastedText(value: string): Promise<string> {
    const timestamp = new Date(this.#now()).toISOString().replaceAll(/[:.]/gu, "-");
    return this.attachText(`pasted-snippet-${timestamp}.txt`, "text/plain", value);
  }

  async replaceBytes(
    id: string,
    name: string,
    mediaType: string,
    value: Uint8Array,
    editor: ComposerAttachmentEditorMetadata | null = null,
  ): Promise<void> {
    const selected = this.#transport.createBytes(name, mediaType, value);
    await this.replaceWith(id, selected, editor);
  }

  remove(id: string): void {
    const index = this.#entries.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    const entry = this.#entries[index];
    if (entry === undefined) return;
    entry.running?.cancel();
    entry.remoteDiscard?.().catch(() => undefined);
    this.#transport.release(entry.attachment);
    this.#entries.splice(index, 1);
    this.publishCurrent();
  }

  async retry(id: string): Promise<void> {
    const entry = this.requireEntry(id);
    if (entry.state !== "error") return;
    entry.error = null;
    entry.state = "selected";
    this.publishCurrent();
    if (this.#target.threadId !== null) await this.upload(entry, this.#target);
  }

  async replace(id: string): Promise<void> {
    const entry = this.requireEntry(id);
    const selected = await this.#transport.pick(
      entry.attachment.mediaType.startsWith("image/") ? "image" : "file",
    );
    if (selected === null) return;
    await this.replaceWith(id, selected, null);
  }

  async prepareInput(text: string, target: ComposerAttachmentTarget): Promise<V2InputBlock[]> {
    this.setTarget(target);
    const uploads = this.#entries.map((entry) => this.prepareEntry(entry, target));
    const attachmentIds = await Promise.all(uploads);
    const input: V2InputBlock[] = [];
    const trimmedText = text.trim();
    if (trimmedText !== "") input.push({ kind: "text", text: trimmedText });
    for (const attachmentId of attachmentIds) {
      input.push({ attachmentId, kind: "attachment" });
    }
    return input;
  }

  clear(): void {
    for (const entry of this.#entries) {
      entry.running?.cancel();
      entry.remoteDiscard?.().catch(() => undefined);
      this.#transport.release(entry.attachment);
    }
    this.#entries.length = 0;
    this.publishCurrent();
  }

  /** Stops in-flight work while retaining durable local files for the next runtime. */
  suspend(): void {
    for (const entry of this.#entries) entry.running?.cancel();
  }

  /** Releases the local draft after the server accepted and consumed its staged attachments. */
  commit(): void {
    for (const entry of this.#entries) {
      entry.running?.cancel();
      this.#transport.release(entry.attachment);
    }
    this.#entries.length = 0;
    this.publishCurrent();
  }

  private async pick(kind: "file" | "image"): Promise<void> {
    const selected = await this.#transport.pick(kind);
    if (selected !== null) await this.add(selected, null);
  }

  private async add(
    attachment: LocalComposerAttachment,
    editor: ComposerAttachmentEditorMetadata | null,
  ): Promise<string> {
    const entry = createEntry(attachment, editor);
    this.#entries.push(entry);
    this.publishCurrent();
    if (this.#target.threadId !== null) await this.upload(entry, this.#target);
    return entry.id;
  }

  private async replaceWith(
    id: string,
    selected: LocalComposerAttachment,
    editor: ComposerAttachmentEditorMetadata | null,
  ): Promise<void> {
    const entry = this.requireEntry(id);
    const index = this.#entries.indexOf(entry);
    entry.running?.cancel();
    entry.remoteDiscard?.().catch(() => undefined);
    this.#transport.release(entry.attachment);
    const replacement = createEntry(selected, editor);
    replacement.id = id;
    this.#entries.splice(index, 1, replacement);
    this.publishCurrent();
    if (this.#target.threadId !== null) await this.upload(replacement, this.#target);
  }

  private async prepareEntry(entry: DraftEntry, target: ComposerAttachmentTarget): Promise<string> {
    if (!this.#entries.includes(entry)) throw new Error("Attachment was removed");
    if (entry.state === "ready" && entry.remoteId !== null) return entry.remoteId;
    if (entry.state === "error") throw new Error(`Retry or remove ${entry.attachment.name}`);
    return this.upload(entry, target);
  }

  private async upload(entry: DraftEntry, target: ComposerAttachmentTarget): Promise<string> {
    if (entry.running !== null) return entry.running.promise.then((result) => result.attachmentId);
    entry.state = "uploading";
    entry.error = null;
    entry.progress = 0;
    let running: RunningComposerAttachmentUpload | null = null;
    try {
      running = this.#transport.upload({
        attachment: entry.attachment,
        onProgress: (progress) => {
          if (running === null || entry.running !== running || !this.#entries.includes(entry))
            return;
          entry.progress =
            progress.totalBytes === 0
              ? 1
              : Math.min(1, progress.transferredBytes / progress.totalBytes);
          this.publishCurrent();
        },
        savedServerId: this.#savedServerId,
        target,
      });
    } catch (cause: unknown) {
      markUploadFailed(entry, cause);
      this.publishCurrent();
      throw cause;
    }
    entry.running = running;
    this.publishCurrent();
    try {
      const result = await running.promise;
      if (!this.#entries.includes(entry)) {
        await result.discard();
        throw new Error("Attachment was removed");
      }
      entry.remoteId = result.attachmentId;
      entry.remoteDiscard = result.discard;
      entry.progress = 1;
      entry.state = "ready";
      return result.attachmentId;
    } catch (cause) {
      if (this.#entries.includes(entry)) markUploadFailed(entry, cause);
      throw cause;
    } finally {
      if (entry.running === running) entry.running = null;
      this.publishCurrent();
    }
  }

  private requireEntry(id: string): DraftEntry {
    const entry = this.#entries.find((candidate) => candidate.id === id);
    if (entry === undefined) throw new Error("Composer attachment is unavailable");
    return entry;
  }

  private publishCurrent(notify = true): void {
    const items = this.#entries.map(toPublicItem);
    this.publish({ status: "ready", value: { items } });
    if (notify) {
      this.#onChange?.(this.#entries.map((entry) => persistedEntry(this.#transport, entry)));
    }
  }
}

function persistedEntry(
  transport: ComposerAttachmentTransport,
  entry: DraftEntry,
): PersistedComposerDraftAttachment {
  return {
    editor: entry.editor,
    error: entry.error,
    local: transport.reference(entry.attachment),
    remoteId: entry.remoteId,
    state: entry.state === "uploading" ? "selected" : entry.state,
  };
}

function createEntry(
  attachment: LocalComposerAttachment,
  editor: ComposerAttachmentEditorMetadata | null,
): DraftEntry {
  return {
    attachment,
    editor,
    error: null,
    id: attachment.handle,
    progress: null,
    remoteDiscard: null,
    remoteId: null,
    running: null,
    state: "selected",
  };
}

function toPublicItem(entry: DraftEntry): ComposerAttachmentDraftItem {
  return {
    editor: entry.editor,
    error: entry.error,
    id: entry.id,
    mediaType: entry.attachment.mediaType,
    name: entry.attachment.name,
    progress: entry.progress,
    sizeBytes: entry.attachment.sizeBytes,
    state: entry.state,
  };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Attachment upload failed";
}

function markUploadFailed(entry: DraftEntry, cause: unknown): void {
  entry.error = errorMessage(cause);
  entry.progress = null;
  entry.state = "error";
}
