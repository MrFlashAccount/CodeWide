import { observable, type Observable } from "@legendapp/state";

import type { StoredDraftAttachment, AttachmentPreview } from "./thread-ui-state-types";
import type { RunningTransfer, TransferProgress } from "../native/file-transfer";

export type ComposerUploadState =
  | { readonly progress: TransferProgress | null; readonly status: "uploading" }
  | { readonly message: string; readonly status: "error" }
  | { readonly status: "ready" };

export interface ComposerUpload {
  readonly attachment: StoredDraftAttachment;
  readonly preview: AttachmentPreview;
  readonly state: ComposerUploadState;
}

export interface ComposerUploadRequest {
  readonly attachment: StoredDraftAttachment;
  commit: (attachment: StoredDraftAttachment, isCurrent: () => boolean) => Promise<void>;
  readonly preview: AttachmentPreview;
  readText: () => Promise<string | null>;
  readonly scope: string;
  start: (progress: (value: TransferProgress) => void) => RunningTransfer;
}

interface UploadJob {
  readonly request: ComposerUploadRequest;
  transfer: RunningTransfer | null;
}

/** Local upload operations survive navigation; they are not server timeline items. */
export class ComposerUploads {
  private readonly scopes = new Map<string, Observable<readonly ComposerUpload[]>>();

  private scope(scope: string): Observable<readonly ComposerUpload[]> {
    const existing = this.scopes.get(scope);
    if (existing !== undefined) {
      return existing;
    }
    const created = observable<readonly ComposerUpload[]>([]);
    this.scopes.set(scope, created);
    return created;
  }
  private readonly jobs = new Map<string, UploadJob>();

  entries(scope: string): readonly ComposerUpload[] {
    return this.scope(scope).get();
  }

  blocksSend(scope: string): boolean {
    return this.entries(scope).some((entry) => entry.state.status !== "ready");
  }

  count(scope: string, stored: readonly StoredDraftAttachment[]): number {
    const ids = new Set(stored.map((attachment) => attachment.id));
    for (const entry of this.entries(scope)) {
      ids.add(entry.attachment.id);
    }
    return ids.size;
  }

  readyAttachments(scope: string, stored: StoredDraftAttachment[]): StoredDraftAttachment[] {
    const entries = this.entries(scope);
    if (entries.length === 0) {
      return stored;
    }
    const managed = new Set(entries.map((entry) => entry.attachment.id));
    const result = stored.filter((attachment) => !managed.has(attachment.id));
    for (const entry of entries) {
      if (entry.state.status === "ready") {
        result.push({ ...entry.attachment, preview: entry.preview });
      }
    }
    return result;
  }

  deleteConnection(connectionId: string): void {
    for (const scope of this.scopes.keys()) {
      if (!scope.startsWith(`${connectionId}\u0000`)) {
        continue;
      }
      for (const entry of this.entries(scope)) {
        this.remove(scope, entry.attachment.id);
      }
      this.scopes.delete(scope);
    }
  }

  stage(request: ComposerUploadRequest): void {
    this.remove(request.scope, request.attachment.id);
    const entry: ComposerUpload = {
      attachment: request.attachment,
      preview: request.preview,
      state: { progress: null, status: "uploading" },
    };
    this.scope(request.scope).set([...this.entries(request.scope), entry]);
    this.launch(request);
  }

  retry(scope: string, id: string): void {
    const job = this.jobs.get(this.key(scope, id));
    if (job === undefined || job.transfer !== null) {
      return;
    }
    this.launch(job.request);
  }

  remove(scope: string, id: string): void {
    const key = this.key(scope, id);
    const job = this.jobs.get(key);
    this.jobs.delete(key);
    job?.transfer?.cancel();
    const entries = this.entries(scope);
    if (entries.some((entry) => entry.attachment.id === id)) {
      this.scope(scope).set(entries.filter((entry) => entry.attachment.id !== id));
    }
  }

  private key(scope: string, id: string): string {
    return `${scope}\u0000${id}`;
  }

  private launch(request: ComposerUploadRequest): void {
    const key = this.key(request.scope, request.attachment.id);
    const job: UploadJob = { request, transfer: null };
    this.jobs.set(key, job);
    const publish = (state: ComposerUploadState): void => {
      if (this.jobs.get(key) !== job) {
        return;
      }
      this.scope(request.scope).set(
        this.entries(request.scope).map((entry) =>
          entry.attachment.id === request.attachment.id ? { ...entry, state } : entry,
        ),
      );
    };
    publish({ progress: null, status: "uploading" });
    void request
      .readText()
      .then((text) => {
        if (this.jobs.get(key) !== job || text === null) {
          return;
        }
        this.scope(request.scope).set(
          this.entries(request.scope).map((entry) =>
            entry.attachment.id === request.attachment.id
              ? { ...entry, preview: { ...entry.preview, text } }
              : entry,
          ),
        );
      })
      .catch(() => undefined);
    (async () => {
      try {
        job.transfer = request.start((progress) => {
          publish({ progress, status: "uploading" });
        });
        await job.transfer.promise;
        if (this.jobs.get(key) !== job) {
          return;
        }
        const preview =
          this.entries(request.scope).find((entry) => entry.attachment.id === request.attachment.id)
            ?.preview ?? request.preview;
        await request.commit({ ...request.attachment, preview }, () => this.jobs.get(key) === job);
        publish({ status: "ready" });
        // Completed jobs release the native File and upload closures immediately.
        if (this.jobs.get(key) === job) {
          this.jobs.delete(key);
        }
      } catch (error) {
        job.transfer = null;
        publish({
          message: error instanceof Error ? error.message : "Upload failed",
          status: "error",
        });
      }
    })().catch((error: unknown) => {
      job.transfer = null;
      publish({
        message: error instanceof Error ? error.message : "Upload failed",
        status: "error",
      });
    });
  }
}

export const composerUploads = new ComposerUploads();
