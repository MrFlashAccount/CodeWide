import { createHash, randomBytes } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { link, lstat, mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { isKnownCodeOrTextFile } from "@codewide/file-types";
import { contentType as formatMimeContentType, lookup as lookupMimeType } from "mime-types";

import { tokenMatches } from "./token.js";
import type { DeviceScope } from "./capabilities.js";

const DEFAULT_MAX_TRANSFER_BYTES = 512 * 1024 * 1024;
const UPLOAD_ID_PATTERN = /^[a-zA-Z0-9_-]{16,80}$/;
const MAX_OBSERVED_PREVIEW_FILES = 4_096;
const MAX_OBSERVED_PREVIEW_ROOTS = 1_024;
const MAX_OBSERVED_THREAD_WORKSPACES = 1_024;
const SOURCE_MIME_COLLISIONS = new Set(["application/rls-services+xml", "video/mp2t"]);

export type ScopedFileServiceOptions = {
  capabilityToken: string;
  authorize?: (authorization: string | undefined, requiredScope: DeviceScope) => boolean;
  roots?: Record<string, string>;
  previewRoots?: string[];
  /**
   * Maps paths reported by the app server to read-only mounts visible inside
   * the companion. This keeps systemd PrivateTmp enabled while allowing an
   * exact observed `/tmp/...` image to be read through a separate bind mount.
   */
  previewPathMappings?: Record<string, string>;
  maxTransferBytes?: number;
  previewRegistryPath?: string;
};

type Root = { id: string; canonicalPath: string };
type PreviewPathMapping = { reportedRoot: string; readableRoot: string };

export class ScopedFileService {
  readonly #roots: Map<string, Root>;
  readonly #previewRoots: string[];
  readonly #previewPathMappings: PreviewPathMapping[];
  readonly #observedPreviewFiles = new Map<string, Promise<string | null>>();
  readonly #observedPreviewRoots = new Map<string, Promise<string | null>>();
  readonly #threadWorkspaces = new Map<string, string>();
  readonly #token: string;
  readonly #authorize: (authorization: string | undefined, requiredScope: DeviceScope) => boolean;
  readonly #maxTransferBytes: number;
  readonly #previewRegistryPath: string | undefined;
  #previewRegistryWriteScheduled = false;
  #previewRegistryWrite = Promise.resolve();

  private constructor(
    options: ScopedFileServiceOptions,
    roots: Root[],
    previewRoots: string[],
    previewPathMappings: PreviewPathMapping[],
    observedPreviewFiles: string[],
  ) {
    this.#roots = new Map(roots.map((root) => [root.id, root]));
    this.#previewRoots = previewRoots;
    this.#previewPathMappings = previewPathMappings;
    for (const filePath of observedPreviewFiles) this.#observedPreviewFiles.set(filePath, Promise.resolve(filePath));
    this.#token = options.capabilityToken;
    this.#authorize = options.authorize ?? ((authorization) => tokenMatches(this.#token, authorization));
    this.#maxTransferBytes = options.maxTransferBytes ?? DEFAULT_MAX_TRANSFER_BYTES;
    this.#previewRegistryPath = options.previewRegistryPath;
  }

  static async create(options: ScopedFileServiceOptions): Promise<ScopedFileService> {
    const roots = await Promise.all(
      Object.entries(options.roots ?? {}).map(async ([id, rootPath]) => {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error(`Invalid file root id: ${id}`);
        return { id, canonicalPath: await realpath(rootPath) };
      }),
    );
    const observedPreviewFiles = options.previewRegistryPath === undefined
      ? []
      : await loadObservedPreviewFiles(options.previewRegistryPath);
    const previewRoots = await Promise.all((options.previewRoots ?? []).map(async (rootPath) => await realpath(rootPath)));
    const previewPathMappings = await Promise.all(
      Object.entries(options.previewPathMappings ?? {}).map(async ([reportedRoot, readableRoot]) => ({
        reportedRoot: path.resolve(reportedRoot),
        readableRoot: await realpath(readableRoot),
      })),
    );
    previewPathMappings.sort((left, right) => right.reportedRoot.length - left.reportedRoot.length);
    return new ScopedFileService(options, roots, previewRoots, previewPathMappings, observedPreviewFiles);
  }

  async close(): Promise<void> {
    await Promise.all(this.#observedPreviewFiles.values());
    await this.#previewRegistryWrite;
    await this.#writePreviewRegistry();
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (requestUrl.pathname !== "/v1/files/download" && requestUrl.pathname !== "/v1/files/upload" && requestUrl.pathname !== "/v1/files/preview") return false;
    const requiredScope: DeviceScope = requestUrl.pathname === "/v1/files/download"
      ? "files.download.workspace"
      : requestUrl.pathname === "/v1/files/preview"
        ? "files.download.workspace"
      : "files.upload.workspace";
    if (!this.#authorize(request.headers.authorization, requiredScope) || request.headers.origin !== undefined) {
      this.#json(response, 401, { error: "unauthorized" });
      return true;
    }
    const rootId = requestUrl.searchParams.get("rootId");
    const relativePath = requestUrl.searchParams.get("path");
    if (requestUrl.pathname === "/v1/files/preview") {
      if (relativePath === null) {
        this.#json(response, 400, { error: "path_required" });
        return true;
      }
      try {
        if (request.method === "GET" || request.method === "HEAD") await this.#preview(request, response, relativePath);
        else this.#json(response, 405, { error: "method_not_allowed" });
      } catch (error) {
        const message = error instanceof ScopedFileError ? error.message : "file_operation_failed";
        const statusCode = error instanceof ScopedFileError ? error.statusCode : 500;
        this.#json(response, statusCode, { error: message });
      }
      return true;
    }
    if (rootId === null || relativePath === null) {
      this.#json(response, 400, { error: "rootId_and_path_required" });
      return true;
    }
    try {
      if (requestUrl.pathname === "/v1/files/download" && (request.method === "GET" || request.method === "HEAD")) {
        await this.#download(request, response, rootId, relativePath);
      } else if (requestUrl.pathname === "/v1/files/upload" && request.method === "HEAD") {
        await this.#uploadStatus(request, response, rootId, relativePath);
      } else if (requestUrl.pathname === "/v1/files/upload" && request.method === "DELETE") {
        await this.#cancelUpload(request, response, rootId, relativePath);
      } else if (requestUrl.pathname === "/v1/files/upload" && request.method === "PUT") {
        await this.#upload(request, response, rootId, relativePath);
      } else {
        this.#json(response, 405, { error: "method_not_allowed" });
      }
    } catch (error) {
      const message = error instanceof ScopedFileError ? error.message : "file_operation_failed";
      const statusCode = error instanceof ScopedFileError ? error.statusCode : 500;
      this.#json(response, statusCode, { error: message });
    }
    return true;
  }

  async resolveInputFile(rootId: string, relativePath: string): Promise<string> {
    return await this.#resolveExistingFile(rootId, relativePath);
  }

  registerPreviewFilesFromAppServer(method: string, payload: unknown, requestParams?: unknown): void {
    for (const { threadId, cwd } of discoverThreadWorkspaces(method, payload)) {
      // Keep the thread-to-workspace association separately: relative links in
      // later item notifications must resolve against the remote thread, not
      // the companion process cwd.
      this.#threadWorkspaces.delete(threadId);
      this.#threadWorkspaces.set(threadId, cwd);
      while (this.#threadWorkspaces.size > MAX_OBSERVED_THREAD_WORKSPACES) {
        const oldest = this.#threadWorkspaces.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.#threadWorkspaces.delete(oldest);
      }

      const canonical = realpath(cwd).then((value) => value, () => null);
      this.#observedPreviewRoots.delete(cwd);
      this.#observedPreviewRoots.set(cwd, canonical);
      while (this.#observedPreviewRoots.size > MAX_OBSERVED_PREVIEW_ROOTS) {
        const oldest = this.#observedPreviewRoots.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.#observedPreviewRoots.delete(oldest);
      }
    }
    for (const filePath of discoverObservedPreviewPaths(method, payload, this.#threadWorkspaces, requestParams)) {
      // Insert before realpath resolves so a preview request racing the RPC
      // response waits for the same authorization decision. The allow-list is
      // exact-file, bounded and populated only from trusted app-server
      // references. Attachments and generated outputs may legitimately live
      // outside cwd; an arbitrary path supplied only by the mobile client is
      // never added here.
      const readablePath = this.#readablePreviewPath(filePath);
      const canonical = realpath(readablePath).then((value) => value, () => null);
      this.#observedPreviewFiles.delete(filePath);
      this.#observedPreviewFiles.set(filePath, canonical);
      while (this.#observedPreviewFiles.size > MAX_OBSERVED_PREVIEW_FILES) {
        const oldest = this.#observedPreviewFiles.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.#observedPreviewFiles.delete(oldest);
      }
      void canonical.then((value) => {
        if (value === null) return;
        this.#observedPreviewFiles.delete(value);
        this.#observedPreviewFiles.set(value, Promise.resolve(value));
        this.#trimObservedPreviewFiles();
        this.#schedulePreviewRegistryWrite();
      });
    }
  }

  async #download(request: IncomingMessage, response: ServerResponse, rootId: string, relativePath: string): Promise<void> {
    const filePath = await this.#resolveExistingFile(rootId, relativePath);
    await this.#sendFile(request, response, filePath, false);
  }

  async #preview(request: IncomingMessage, response: ServerResponse, absolutePath: string): Promise<void> {
    if (!path.isAbsolute(absolutePath) || absolutePath.length > 16_384 || absolutePath.includes("\0")) {
      throw new ScopedFileError(400, "invalid_absolute_path");
    }
    const readablePath = this.#readablePreviewPath(absolutePath);
    const canonical = await realpath(readablePath).catch(() => {
      throw new ScopedFileError(404, "file_not_found");
    });
    const observedCanonical = await (
      this.#observedPreviewFiles.get(absolutePath)
      ?? this.#observedPreviewFiles.get(readablePath)
      ?? this.#observedPreviewFiles.get(canonical)
    );
    const insideConfiguredRoot = [...this.#roots.values()].some((root) => isChild(root.canonicalPath, canonical));
    const insidePreviewRoot = this.#previewRoots.some((root) => isChild(root, canonical));
    const observedRoots = await Promise.all(this.#observedPreviewRoots.values());
    const insideObservedRoot = observedRoots.some((root) => root !== null && isChild(root, canonical));
    if (!insideConfiguredRoot && !insidePreviewRoot && !insideObservedRoot && observedCanonical !== canonical) {
      throw new ScopedFileError(403, "path_outside_root");
    }
    await this.#sendFile(request, response, canonical, true);
  }

  #readablePreviewPath(reportedPath: string): string {
    const normalized = path.normalize(reportedPath);
    for (const mapping of this.#previewPathMappings) {
      if (!isChild(mapping.reportedRoot, normalized)) continue;
      return path.join(mapping.readableRoot, path.relative(mapping.reportedRoot, normalized));
    }
    return normalized;
  }

  #trimObservedPreviewFiles(): void {
    while (this.#observedPreviewFiles.size > MAX_OBSERVED_PREVIEW_FILES) {
      const oldest = this.#observedPreviewFiles.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#observedPreviewFiles.delete(oldest);
    }
  }

  #schedulePreviewRegistryWrite(): void {
    if (this.#previewRegistryPath === undefined || this.#previewRegistryWriteScheduled) return;
    this.#previewRegistryWriteScheduled = true;
    queueMicrotask(() => {
      this.#previewRegistryWriteScheduled = false;
      this.#previewRegistryWrite = this.#previewRegistryWrite
        .then(async () => await this.#writePreviewRegistry())
        .catch((cause: unknown) => {
          console.error("Failed to persist the exact preview-file registry", cause);
        });
    });
  }

  async #writePreviewRegistry(): Promise<void> {
    if (this.#previewRegistryPath === undefined) return;
    const resolved = await Promise.all(this.#observedPreviewFiles.values());
    const files = [...new Set(resolved.filter((value): value is string => value !== null))].slice(-MAX_OBSERVED_PREVIEW_FILES);
    const directory = path.dirname(this.#previewRegistryPath);
    const temporary = path.join(directory, `.${path.basename(this.#previewRegistryPath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporary, `${JSON.stringify({ version: 1, files })}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, this.#previewRegistryPath);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async #sendFile(request: IncomingMessage, response: ServerResponse, filePath: string, inline: boolean): Promise<void> {
    const metadata = await stat(filePath);
    if (!metadata.isFile()) throw new ScopedFileError(400, "not_a_regular_file");
    if (metadata.size > this.#maxTransferBytes) throw new ScopedFileError(413, "file_too_large");
    const sha256 = await hashFile(filePath);
    const range = parseRange(request.headers.range, metadata.size);
    response.writeHead(range === null ? 200 : 206, {
      "accept-ranges": "bytes",
      "content-type": contentType(filePath),
      "content-length": String(range === null ? metadata.size : range.end - range.start + 1),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      ...(inline ? { "content-security-policy": "default-src 'none'; sandbox" } : {}),
      "x-content-sha256": sha256,
      ...(range === null ? {} : { "content-range": `bytes ${range.start}-${range.end}/${metadata.size}` }),
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    await pipeline(createReadStream(filePath, range === null ? {} : { start: range.start, end: range.end }), response);
  }

  async #upload(request: IncomingMessage, response: ServerResponse, rootId: string, relativePath: string): Promise<void> {
    const expectedHash = request.headers["x-content-sha256"];
    if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(expectedHash)) {
      throw new ScopedFileError(400, "valid_x_content_sha256_required");
    }
    const contentLength = Number(request.headers["content-length"] ?? "NaN");
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) throw new ScopedFileError(411, "content_length_required");
    if (contentLength > this.#maxTransferBytes) throw new ScopedFileError(413, "file_too_large");
    const uploadId = request.headers["x-upload-id"];
    const contentRange = request.headers["content-range"];
    if (uploadId !== undefined || contentRange !== undefined) {
      if (typeof uploadId !== "string" || !UPLOAD_ID_PATTERN.test(uploadId)) throw new ScopedFileError(400, "valid_x_upload_id_required");
      if (typeof contentRange !== "string") throw new ScopedFileError(400, "content_range_required");
      await this.#uploadChunk(request, response, rootId, relativePath, uploadId, expectedHash, contentLength, contentRange);
      return;
    }
    const target = await this.#resolveUploadTarget(rootId, relativePath);
    const overwrite = request.headers["x-codex-overwrite"] === "true";
    const targetExists = await lstat(target).then(() => true, () => false);
    if (targetExists && !overwrite) throw new ScopedFileError(409, "target_exists");
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.upload-${randomBytes(8).toString("hex")}`);
    let bytes = 0;
    const hash = createHash("sha256");
    const verifier = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > contentLength) {
          callback(new ScopedFileError(413, "file_too_large"));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(request, verifier, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
      if (bytes !== contentLength) throw new ScopedFileError(400, "content_length_mismatch");
      const actualHash = hash.digest("hex");
      if (actualHash !== expectedHash) throw new ScopedFileError(422, "sha256_mismatch");
      if (overwrite) await rename(temporary, target);
      else {
        // link(2) makes the no-overwrite guarantee atomic. A second writer
        // cannot create the target between the preflight check and publish.
        await link(temporary, target).catch((cause: NodeJS.ErrnoException) => {
          if (cause.code === "EEXIST") throw new ScopedFileError(409, "target_exists");
          throw cause;
        });
        await rm(temporary, { force: true });
      }
      this.#json(response, targetExists ? 200 : 201, { ok: true, bytes, sha256: actualHash });
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async #uploadStatus(request: IncomingMessage, response: ServerResponse, rootId: string, relativePath: string): Promise<void> {
    const uploadId = request.headers["x-upload-id"];
    if (typeof uploadId !== "string" || !UPLOAD_ID_PATTERN.test(uploadId)) throw new ScopedFileError(400, "valid_x_upload_id_required");
    const target = await this.#resolveUploadTarget(rootId, relativePath);
    const temporary = resumablePath(target, uploadId);
    const metadata = await lstat(temporary).catch(() => null);
    if (metadata === null) {
      const targetMetadata = await lstat(target).catch(() => null);
      const expectedHash = request.headers["x-content-sha256"];
      if (targetMetadata?.isFile() === true && typeof expectedHash === "string" && /^[a-f0-9]{64}$/.test(expectedHash) && targetMetadata.size <= this.#maxTransferBytes) {
        const actualHash = await hashFile(target);
        if (actualHash === expectedHash) {
          response.writeHead(200, {
            "x-upload-complete": "true",
            "x-upload-offset": String(targetMetadata.size),
            "x-content-sha256": actualHash,
          });
          response.end();
          return;
        }
      }
      response.writeHead(404, { "x-upload-offset": "0" });
      response.end();
      return;
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new ScopedFileError(403, "unsafe_upload_state");
    if (metadata.size > this.#maxTransferBytes) throw new ScopedFileError(413, "file_too_large");
    response.writeHead(204, { "x-upload-offset": String(metadata.size) });
    response.end();
  }

  async #cancelUpload(request: IncomingMessage, response: ServerResponse, rootId: string, relativePath: string): Promise<void> {
    const uploadId = request.headers["x-upload-id"];
    if (typeof uploadId !== "string" || !UPLOAD_ID_PATTERN.test(uploadId)) throw new ScopedFileError(400, "valid_x_upload_id_required");
    const target = await this.#resolveUploadTarget(rootId, relativePath);
    await rm(resumablePath(target, uploadId), { force: true });
    response.writeHead(204);
    response.end();
  }

  async #uploadChunk(
    request: IncomingMessage,
    response: ServerResponse,
    rootId: string,
    relativePath: string,
    uploadId: string,
    expectedHash: string,
    contentLength: number,
    rawContentRange: string,
  ): Promise<void> {
    const range = parseContentRange(rawContentRange);
    if (range.end - range.start + 1 !== contentLength) throw new ScopedFileError(400, "content_range_length_mismatch");
    if (range.total > this.#maxTransferBytes) throw new ScopedFileError(413, "file_too_large");
    const target = await this.#resolveUploadTarget(rootId, relativePath);
    const temporary = resumablePath(target, uploadId);
    const overwrite = request.headers["x-codex-overwrite"] === "true";
    const targetExistsAtStart = await lstat(target).then(() => true, () => false);
    if (range.start === 0 && targetExistsAtStart && !overwrite) throw new ScopedFileError(409, "target_exists");

    const existing = await lstat(temporary).catch(() => null);
    const expectedOffset = existing?.size ?? 0;
    if (existing !== null && (!existing.isFile() || existing.isSymbolicLink())) throw new ScopedFileError(403, "unsafe_upload_state");
    if (expectedOffset !== range.start) {
      response.writeHead(409, { "content-type": "application/json", "x-upload-offset": String(expectedOffset) });
      response.end(`${JSON.stringify({ error: "upload_offset_mismatch", offset: expectedOffset })}\n`);
      return;
    }

    const flags = range.start === 0
      ? constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW
      : constants.O_WRONLY | constants.O_NOFOLLOW;
    const handle = await open(temporary, flags, 0o600).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === "EEXIST") throw new ScopedFileError(409, "upload_offset_mismatch");
      throw cause;
    });
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > contentLength) callback(new ScopedFileError(413, "file_too_large"));
        else callback(null, chunk);
      },
    });
    try {
      await pipeline(request, limiter, handle.createWriteStream({ start: range.start, autoClose: true }));
    } catch (cause) {
      await handle.close().catch(() => undefined);
      throw cause;
    }
    if (bytes !== contentLength) throw new ScopedFileError(400, "content_length_mismatch");
    const nextOffset = range.end + 1;
    if (nextOffset < range.total) {
      response.writeHead(308, { "x-upload-offset": String(nextOffset) });
      response.end();
      return;
    }
    if (nextOffset !== range.total) throw new ScopedFileError(400, "invalid_content_range");
    const actualHash = await hashFile(temporary);
    if (actualHash !== expectedHash) {
      await rm(temporary, { force: true });
      throw new ScopedFileError(422, "sha256_mismatch");
    }
    const targetExistsNow = await lstat(target).then(() => true, () => false);
    if (!overwrite && targetExistsNow) throw new ScopedFileError(409, "target_exists");
    if (overwrite) await rename(temporary, target);
    else {
      await link(temporary, target).catch((cause: NodeJS.ErrnoException) => {
        if (cause.code === "EEXIST") throw new ScopedFileError(409, "target_exists");
        throw cause;
      });
      await rm(temporary, { force: true });
    }
    this.#json(response, targetExistsNow ? 200 : 201, { ok: true, bytes: range.total, sha256: actualHash });
  }

  async #resolveExistingFile(rootId: string, relativePath: string): Promise<string> {
    const root = this.#root(rootId);
    const candidate = lexicalChild(root.canonicalPath, relativePath);
    const canonical = await realpath(candidate).catch(() => {
      throw new ScopedFileError(404, "file_not_found");
    });
    if (!isChild(root.canonicalPath, canonical)) throw new ScopedFileError(403, "path_outside_root");
    return canonical;
  }

  async #resolveUploadTarget(rootId: string, relativePath: string): Promise<string> {
    const root = this.#root(rootId);
    const candidate = lexicalChild(root.canonicalPath, relativePath);
    const canonicalParent = await realpath(path.dirname(candidate)).catch(() => {
      throw new ScopedFileError(404, "parent_not_found");
    });
    if (!isChild(root.canonicalPath, canonicalParent)) throw new ScopedFileError(403, "path_outside_root");
    const target = path.join(canonicalParent, path.basename(candidate));
    const existingCanonical = await realpath(target).catch(() => null);
    if (existingCanonical !== null && !isChild(root.canonicalPath, existingCanonical)) {
      throw new ScopedFileError(403, "path_outside_root");
    }
    return target;
  }

  #root(rootId: string): Root {
    const root = this.#roots.get(rootId);
    if (root === undefined) throw new ScopedFileError(404, "unknown_root");
    return root;
  }

  #json(response: ServerResponse, statusCode: number, body: unknown): void {
    response.writeHead(statusCode, { "content-type": "application/json" });
    response.end(`${JSON.stringify(body)}\n`);
  }
}

const FILES_HEADING = /^# Files mentioned by the user:\s*$/m;
const REQUEST_HEADING = /^## My request for Codex:\s*$/m;
const FILE_ENTRY = /^##\s+.+?:\s*(?:`([^`\n]+)`|([^\n]+))\s*$/gm;
const MARKDOWN_LINK = /!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|((?:\\.|[^)\s])+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g;

async function loadObservedPreviewFiles(registryPath: string): Promise<string[]> {
  const raw = await readFile(registryPath, "utf8").catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return null;
    throw cause;
  });
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; files?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.files)) return [];
    const candidates = parsed.files.filter((value): value is string => (
      typeof value === "string"
      && path.isAbsolute(value)
      && value.length <= 16_384
      && !value.includes("\0")
    )).slice(-MAX_OBSERVED_PREVIEW_FILES);
    const canonical = await Promise.all(candidates.map(async (candidate) => await realpath(candidate).catch(() => null)));
    return [...new Set(canonical.filter((value): value is string => value !== null))];
  } catch {
    return [];
  }
}

function discoverObservedPreviewPaths(
  method: string,
  payload: unknown,
  threadWorkspaces: ReadonlyMap<string, string>,
  requestParams?: unknown,
): string[] {
  const discovered = new Set<string>();
  const root = objectValue(payload);
  if (root === null) return [];
  const context = objectValue(requestParams);
  const payloadThread = objectValue(root.thread);
  const outerThreadId = typeof root.threadId === "string"
    ? root.threadId
    : typeof payloadThread?.id === "string"
      ? payloadThread.id
      : typeof context?.threadId === "string" ? context.threadId : null;
  const outerCwd = outerThreadId === null ? undefined : threadWorkspaces.get(outerThreadId);
  const collectPath = (candidate: unknown, cwd?: string): void => {
    if (
      typeof candidate === "string"
      && candidate.length <= 16_384
      && !candidate.includes("\0")
    ) {
      const absolute = path.isAbsolute(candidate)
        ? path.normalize(candidate)
        : cwd === undefined ? null : path.resolve(cwd, candidate);
      if (absolute !== null) discovered.add(absolute);
    }
  };
  const collectMentionedFiles = (text: string, cwd?: string): void => {
    const filesHeading = FILES_HEADING.exec(text);
    const requestHeading = REQUEST_HEADING.exec(text);
    if (filesHeading === null || requestHeading === null || filesHeading.index >= requestHeading.index) return;
    const section = text.slice(filesHeading.index, requestHeading.index);
    FILE_ENTRY.lastIndex = 0;
    for (const match of section.matchAll(FILE_ENTRY)) collectPath((match[1] ?? match[2])?.trim(), cwd);
  };
  const collectMarkdownLinks = (text: string, cwd?: string): void => {
    MARKDOWN_LINK.lastIndex = 0;
    for (const match of text.matchAll(MARKDOWN_LINK)) {
      const raw = (match[1] ?? match[2])?.replaceAll("\\ ", " ").trim();
      if (raw === undefined || raw === "" || raw.startsWith("#") || raw.startsWith("//") || /^[a-z][a-z\d+.-]*:/iu.test(raw)) continue;
      const withoutFragment = raw.split("#", 1)[0]?.split("?", 1)[0] ?? "";
      try {
        collectPath(decodeURIComponent(withoutFragment), cwd);
      } catch {
        // Malformed URL escapes are not local file references.
      }
    }
  };
  const collectItem = (rawItem: unknown, cwd?: string): void => {
    const item = objectValue(rawItem);
    if (item === null) return;
    if (item.type === "userMessage" && Array.isArray(item.content)) {
      for (const rawPart of item.content) {
        const part = objectValue(rawPart);
        if (part === null) continue;
        if (["localImage", "localAudio", "mention", "skill"].includes(String(part.type))) collectPath(part.path, cwd);
        if (part.type === "text" && typeof part.text === "string") collectMentionedFiles(part.text, cwd);
      }
    } else if (item.type === "agentMessage" && typeof item.text === "string") {
      collectMarkdownLinks(item.text, cwd);
    } else if (item.type === "fileChange" && Array.isArray(item.changes)) {
      for (const rawChange of item.changes) collectPath(objectValue(rawChange)?.path, cwd);
    } else if (item.type === "imageView") {
      collectPath(item.path, cwd);
    } else if (item.type === "imageGeneration") {
      collectPath(item.savedPath, cwd);
    }
  };
  const collectTurn = (rawTurn: unknown, cwd?: string): void => {
    const turn = objectValue(rawTurn);
    if (Array.isArray(turn?.items)) turn.items.forEach((item) => collectItem(item, cwd));
  };
  const collectThread = (rawThread: unknown): void => {
    const thread = objectValue(rawThread);
    const cwd = typeof thread?.cwd === "string" && path.isAbsolute(thread.cwd)
      ? thread.cwd
      : typeof thread?.id === "string" ? threadWorkspaces.get(thread.id) : undefined;
    if (Array.isArray(thread?.turns)) thread.turns.forEach((turn) => collectTurn(turn, cwd));
  };
  if (["thread/resume", "thread/read", "thread/fork", "thread/start", "thread/rollback"].includes(method)) {
    collectThread(root.thread);
    if (method === "thread/resume") {
      const page = objectValue(root.initialTurnsPage);
      if (Array.isArray(page?.data)) page.data.forEach((turn) => collectTurn(turn, outerCwd));
    }
  } else if (method === "thread/turns/list") {
    if (Array.isArray(root.data)) root.data.forEach((turn) => collectTurn(turn, outerCwd));
  } else if (method === "thread/items/list") {
    if (Array.isArray(root.data)) {
      for (const rawEntry of root.data) collectItem(objectValue(rawEntry)?.item, outerCwd);
    }
  } else if (method === "companion/threadResources/read") {
    if (Array.isArray(root.changes)) {
      for (const rawChange of root.changes) collectPath(objectValue(rawChange)?.path, outerCwd);
    }
    if (Array.isArray(root.attachments)) {
      for (const rawAttachment of root.attachments) collectPath(objectValue(rawAttachment)?.path, outerCwd);
    }
  } else if (method === "companion/threadChange/read") {
    collectPath(root.path, outerCwd);
  } else if (method === "thread/started") {
    collectThread(root.thread);
  } else if (method === "turn/started" || method === "turn/completed") {
    collectTurn(root.turn, outerCwd);
  } else if (method === "item/started" || method === "item/completed") {
    collectItem(root.item, outerCwd);
  }
  return [...discovered];
}

function discoverThreadWorkspaces(method: string, payload: unknown): Array<{ threadId: string; cwd: string }> {
  const discovered = new Map<string, string>();
  const root = objectValue(payload);
  if (root === null) return [];
  const collectThread = (rawThread: unknown): void => {
    const thread = objectValue(rawThread);
    const threadId = thread?.id;
    const cwd = thread?.cwd;
    if (
      typeof threadId === "string"
      && typeof cwd === "string"
      && path.isAbsolute(cwd)
      && cwd.length <= 16_384
      && !cwd.includes("\0")
    ) discovered.set(threadId, cwd);
  };
  if (["thread/resume", "thread/read", "thread/fork", "thread/start", "thread/rollback"].includes(method)) {
    collectThread(root.thread);
  } else if (method === "thread/started") {
    collectThread(root.thread);
  } else if (method === "thread/list" || method === "thread/search") {
    if (Array.isArray(root.data)) root.data.forEach(collectThread);
  }
  return [...discovered].map(([threadId, cwd]) => ({ threadId, cwd }));
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

class ScopedFileError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

function lexicalChild(root: string, relativePath: string): string {
  if (relativePath.length === 0 || relativePath.includes("\0") || path.isAbsolute(relativePath)) {
    throw new ScopedFileError(400, "invalid_relative_path");
  }
  const candidate = path.resolve(root, relativePath);
  if (!isChild(root, candidate)) throw new ScopedFileError(403, "path_outside_root");
  return candidate;
}

function isChild(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function contentType(filePath: string): string {
  const mime = lookupMimeType(filePath);
  const detected = mime === false ? false : formatMimeContentType(mime);
  if (!isKnownCodeOrTextFile(filePath)) return detected || "application/octet-stream";
  if (detected === "application/wasm") return detected;
  if (detected && SOURCE_MIME_COLLISIONS.has(detected.split(";", 1)[0]?.trim().toLowerCase() ?? "")) {
    return "text/plain; charset=utf-8";
  }
  if (detected && isTextualContentType(detected)) return detected;
  // mime-db has unavoidable filename collisions: notably `.ts` resolves to
  // video/mp2t. A source filename from the shared editor registry is safer as
  // plain text than as an unrelated binary media type.
  return "text/plain; charset=utf-8";
}

function isTextualContentType(value: string): boolean {
  const mime = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mime.startsWith("text/")
    || mime === "application/json"
    || mime.endsWith("+json")
    || mime === "application/javascript"
    || mime === "application/xml"
    || mime.endsWith("+xml")
    || mime === "application/yaml";
}

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (header === undefined) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (match === null) throw new ScopedFileError(416, "invalid_range");
  const start = Number(match[1]);
  const requestedEnd = match[2] === "" ? size - 1 : Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || start > requestedEnd) {
    throw new ScopedFileError(416, "invalid_range");
  }
  // RFC 9110: a last-byte-pos beyond the selected representation is valid;
  // the server serves through EOF instead of rejecting a useful range.
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function parseContentRange(header: string): { start: number; end: number; total: number } {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(header);
  if (match === null) throw new ScopedFileError(400, "invalid_content_range");
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(total) || start < 0 || start > end || end >= total) {
    throw new ScopedFileError(400, "invalid_content_range");
  }
  return { start, end, total };
}

function resumablePath(target: string, uploadId: string): string {
  return path.join(path.dirname(target), `.${path.basename(target)}.upload-${uploadId}.part`);
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}
