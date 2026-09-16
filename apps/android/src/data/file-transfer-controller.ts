import { fileMediaKind } from "@codewide/file-types";

import {
  startDownload,
  startUpload,
  type RunningTransfer,
  type SelectedDirectory,
  type SelectedUpload,
} from "../native/file-transfer";
import type { WorkspaceResourceDatabase } from "./workspace-resource-database";
import type { GetTransferAccess } from "./private-transfer";

type UploadedAttachment = {
  id: string;
  kind: "image" | "audio" | "file";
  name: string;
  path: string;
  rootId: string;
};

export class FileTransferController {
  private readonly running = new Map<string, RunningTransfer>();
  private readonly generations = new Map<string, number>();
  private readonly resources: WorkspaceResourceDatabase;

  constructor(resources: WorkspaceResourceDatabase) {
    this.resources = resources;
  }

  async start(options: {
    directory: SelectedDirectory | null;
    getAccess: GetTransferAccess;
    mode: "upload" | "download";
    onUploaded?: (attachment: UploadedAttachment) => void;
    overwrite: boolean;
    remotePath: string;
    rootId: string;
    scope: string;
    upload: SelectedUpload | null;
  }): Promise<void> {
    if (this.running.has(options.scope)) {
      return;
    }
    const generation = (this.generations.get(options.scope) ?? 0) + 1;
    this.generations.set(options.scope, generation);
    this.put(options.scope, "authorizing", null, null, null);
    try {
      const task =
        options.mode === "upload"
          ? options.upload === null
            ? null
            : startUpload(
                options.getAccess,
                options.upload,
                options.rootId,
                options.remotePath,
                options.overwrite,
                (progress) => {
                  if (this.isCurrent(options.scope, generation)) {
                    this.put(options.scope, "running", progress, null, null);
                  }
                },
              )
          : options.directory === null
            ? null
            : startDownload(
                options.getAccess,
                options.directory,
                options.rootId,
                options.remotePath,
                (progress) => {
                  if (this.isCurrent(options.scope, generation)) {
                    this.put(options.scope, "running", progress, null, null);
                  }
                },
              );
      if (task === null) {
        throw new Error(
          options.mode === "upload" ? "Choose a file first" : "Choose a destination folder first",
        );
      }
      if (!this.isCurrent(options.scope, generation)) {
        task.cancel();
        return;
      }
      this.running.set(options.scope, task);
      this.put(options.scope, "running", null, null, null);
      const value = await task.promise;
      if (!this.isCurrent(options.scope, generation)) {
        return;
      }
      const result = `${value.bytes.toLocaleString()} bytes · SHA-256 ${value.sha256.slice(0, 12)}…${value.uri === undefined ? "" : ` · ${value.uri}`}`;
      this.put(options.scope, "complete", null, result, null);
      if (options.mode === "upload" && options.upload !== null) {
        options.onUploaded?.({
          id: `${value.sha256.slice(0, 32)}-${Date.now().toString(36)}`,
          kind: attachmentKind(options.upload.mimeType, options.upload.name),
          name: options.upload.name,
          path: options.remotePath,
          rootId: options.rootId,
        });
      }
    } catch (error) {
      if (this.isCurrent(options.scope, generation)) {
        this.put(
          options.scope,
          "error",
          null,
          null,
          error instanceof Error ? error.message : "Transfer failed",
        );
      }
      throw error;
    } finally {
      if (this.isCurrent(options.scope, generation)) {
        this.running.delete(options.scope);
      }
    }
  }

  cancel(scope: string): void {
    this.generations.set(scope, (this.generations.get(scope) ?? 0) + 1);
    this.running.get(scope)?.cancel();
    this.running.delete(scope);
    this.put(scope, "idle", null, null, null);
  }

  private isCurrent(scope: string, generation: number): boolean {
    return this.generations.get(scope) === generation;
  }

  private put(
    scope: string,
    status: "idle" | "authorizing" | "running" | "complete" | "error",
    progress: {
      phase: "hashing" | "transferring" | "verifying";
      total: number;
      transferred: number;
    } | null,
    result: string | null,
    error: string | null,
  ): void {
    this.resources.putFileTransfer({ error, id: scope, progress, result, scope, status });
  }
}

function attachmentKind(mimeType: string, name: string): "image" | "audio" | "file" {
  return fileMediaKind(name, mimeType) ?? "file";
}
