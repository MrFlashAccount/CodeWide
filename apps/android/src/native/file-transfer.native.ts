import { sha256 } from "@noble/hashes/sha2.js";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import { Linking, NativeModules } from "react-native";
import { recordTiming } from "../data/operational-metrics";
import { unknownRecord } from "../data/unknownRecord";

import {
  fetchPrivateAsset,
  fetchScopedUpload,
  type GetTransferAccess,
  type PrivateAssetSource,
} from "../data/private-transfer";

export type TransferProgress = {
  phase: "hashing" | "transferring" | "verifying";
  total: number;
  transferred: number;
};
export type SelectedUpload = { mimeType: string; name: string; native: File; size: number };
export type SelectedDirectory = { name: string; native: Directory };
export function selectedUploadUri(upload: SelectedUpload): string | null {
  return upload.native.uri;
}

/** A local card never reads the whole file to display its excerpt. */
export async function selectedUploadText(upload: SelectedUpload): Promise<string | null> {
  const text = await Promise.resolve().then(() => {
    if (
      !upload.mimeType.startsWith("text/") &&
      !/\.(?:md|txt|json|csv|tsx?|jsx?|rs|py|sh|ya?ml|toml|log)$/iu.test(upload.name)
    ) {
      return null;
    }
    const handle = upload.native.open();
    try {
      return new TextDecoder().decode(handle.readBytes(Math.min(upload.size, 2048))).slice(0, 512);
    } finally {
      handle.close();
    }
  });
  return text;
}
export type RunningTransfer = {
  cancel: () => void;
  promise: Promise<{ bytes: number; mimeType?: string; sha256: string; uri?: string }>;
};

type FileTransferBridge = {
  copyContentDocument?: (
    sourceUri: string,
    targetUri: string,
  ) => Promise<{ bytes: number; sha256: string }>;
  hashContentDocument?: (uri: string) => Promise<{ bytes: number; sha256: string }>;
  openDocument?: (uri: string, mimeType: string | null) => Promise<void>;
};

// WHY: React Native's module registry exposes the installed native bridge as any and has no
// generated TypeScript declaration for these optional OTA-compatible methods.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const fileTransferBridge = NativeModules.CodeWideNative as FileTransferBridge | undefined;

export async function openDownloadedFile(uri: string, mimeType?: string): Promise<void> {
  if (fileTransferBridge?.openDocument !== undefined) {
    await fileTransferBridge.openDocument(uri, mimeType ?? null);
    return;
  }
  // Compatibility for OTA clients whose native runtime predates openDocument.
  await Linking.openURL(uri);
}

export async function pickUploadFile(): Promise<SelectedUpload | null> {
  const picked = await File.pickFileAsync({ mimeTypes: "*/*" });
  if (picked.canceled) {
    return null;
  }
  return {
    mimeType: picked.result.type === "" ? "application/octet-stream" : picked.result.type,
    name: picked.result.name,
    native: picked.result,
    size: picked.result.size,
  };
}

export function createTextUpload(name: string, mimeType: string, source: string): SelectedUpload {
  const safeName = safeUploadName(name, "attachment.txt");
  const file = new File(Paths.cache, `codewide-${Date.now().toString(36)}-${safeName}`);
  file.create({ intermediates: true, overwrite: true });
  file.write(source);
  return { mimeType, name: safeName, native: file, size: file.size };
}

export function createBinaryUpload(
  name: string,
  mimeType: string,
  source: Uint8Array,
): SelectedUpload {
  const safeName = safeUploadName(name, "attachment.bin");
  const file = new File(Paths.cache, `codewide-${Date.now().toString(36)}-${safeName}`);
  file.create({ intermediates: true, overwrite: true });
  file.write(source);
  return { mimeType, name: safeName, native: file, size: file.size };
}

function safeUploadName(name: string, fallback: string): string {
  const sanitized = name.replaceAll(/[^a-zA-Z0-9._-]+/g, "-").replaceAll(/^-+|-+$/g, "");
  return sanitized === "" ? fallback : sanitized;
}

export async function pickDownloadDirectory(): Promise<SelectedDirectory> {
  const directory = await Directory.pickDirectoryAsync();
  return { name: directory.name, native: directory };
}

export function startUpload(
  getAccess: GetTransferAccess,
  file: SelectedUpload,
  rootId: string,
  remotePath: string,
  overwrite: boolean,
  onProgress: (progress: TransferProgress) => void,
): RunningTransfer {
  let cancelled = false;
  const isCancelled = (): boolean => cancelled;
  let activeRequest: AbortController | null = null;
  const uploadStartedAt = performance.now();
  let transferStartedAt: number | null = null;
  const promise = (async () => {
    // Publish the local attachment before hashing can occupy the JS thread.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    const hash = await hashFile(
      file.native,
      (transferred) => {
        onProgress({ phase: "hashing", total: file.size, transferred });
      },
      isCancelled,
    );
    transferStartedAt = performance.now();
    recordTiming("attachment_hash_ms", transferStartedAt - uploadStartedAt);
    if (isCancelled()) {
      throw new Error("Transfer cancelled");
    }
    const uploadId = `sha256-${hash}`;
    const commonHeaders = {
      "content-type": file.native.type === "" ? "application/octet-stream" : file.native.type,
      "x-codex-overwrite": overwrite ? "true" : "false",
      "x-content-sha256": hash,
      "x-upload-id": uploadId,
    };
    let status = await uploadStatus(getAccess, rootId, remotePath, commonHeaders, file.size, hash);
    if (status.complete) {
      return { bytes: file.size, sha256: hash };
    }
    let offset = status.offset;
    const handle = file.native.open();
    let finalBody: { bytes: number; sha256: string } | null = null;
    try {
      handle.offset = offset;
      while (offset < file.size) {
        if (isCancelled()) {
          throw new Error("Transfer cancelled");
        }
        const chunk = handle.readBytes(Math.min(4 * 1024 * 1024, file.size - offset));
        if (chunk.length === 0) {
          throw new Error("Could not read the complete upload file");
        }
        const start = offset;
        const end = start + chunk.length - 1;
        let response: Response | null = null;
        for (let attempt = 0; attempt < 4 && response === null; attempt += 1) {
          const requestController = new AbortController();
          activeRequest = requestController;
          try {
            response = await fetchScopedUpload(rootId, remotePath, getAccess, {
              body: chunk,
              headers: {
                ...commonHeaders,
                "content-range": `bytes ${String(start)}-${String(end)}/${String(file.size)}`,
              },
              method: "PUT",
              signal: requestController.signal,
            });
          } catch (error) {
            if (isCancelled()) {
              // WHY: Cancellation is authoritative, and the fetch error may contain a secret-bearing URL.
              // oxlint-disable-next-line preserve-caught-error
              throw new Error("Transfer cancelled");
            }
            if (attempt === 3) {
              throw error;
            }
            await delay(150 * 2 ** attempt);
            status = await uploadStatus(
              getAccess,
              rootId,
              remotePath,
              commonHeaders,
              file.size,
              hash,
            );
            if (status.complete) {
              return { bytes: file.size, sha256: hash };
            }
            if (status.offset !== start) {
              offset = status.offset;
              handle.offset = offset;
              break;
            }
          } finally {
            activeRequest = null;
          }
        }
        if (offset !== start) {
          continue;
        }
        if (response === null) {
          throw new Error("Upload request did not complete");
        }
        const acknowledged = Number(response.headers.get("x-upload-offset") ?? end + 1);
        if (
          response.status === 409 &&
          Number.isSafeInteger(acknowledged) &&
          acknowledged >= 0 &&
          acknowledged <= file.size &&
          acknowledged !== start
        ) {
          offset = acknowledged;
          handle.offset = offset;
          continue;
        }
        if (response.status === 308) {
          if (acknowledged !== end + 1) {
            throw new Error("Host acknowledged an invalid upload offset");
          }
          offset = acknowledged;
          onProgress({ phase: "transferring", total: file.size, transferred: offset });
          continue;
        }
        const bodyText = await response.text();
        if (!response.ok) {
          throw new Error(`Upload failed (${String(response.status)}): ${bodyText.slice(0, 200)}`);
        }
        const parsedBody = unknownRecord(JSON.parse(bodyText));
        if (
          parsedBody === null ||
          typeof parsedBody.bytes !== "number" ||
          typeof parsedBody.sha256 !== "string"
        ) {
          throw new Error("Upload completion response is invalid");
        }
        finalBody = { bytes: parsedBody.bytes, sha256: parsedBody.sha256 };
        offset = file.size;
        onProgress({ phase: "transferring", total: file.size, transferred: offset });
      }
    } finally {
      handle.close();
    }
    if (finalBody === null) {
      status = await uploadStatus(getAccess, rootId, remotePath, commonHeaders, file.size, hash);
      if (!status.complete) {
        throw new Error("Host did not finalize the upload");
      }
      finalBody = { bytes: file.size, sha256: hash };
    }
    const body = finalBody;
    if (body.sha256 !== hash || body.bytes !== file.size) {
      throw new Error("Upload integrity response did not match the local file");
    }
    return { bytes: body.bytes, sha256: body.sha256 };
  })().finally(() => {
    const finishedAt = performance.now();
    recordTiming("attachment_upload_ms", finishedAt - uploadStartedAt);
    if (transferStartedAt !== null) {
      recordTiming("attachment_transfer_ms", finishedAt - transferStartedAt);
    }
  });
  return {
    cancel() {
      cancelled = true;
      activeRequest?.abort();
    },
    promise,
  };
}

async function uploadStatus(
  getAccess: GetTransferAccess,
  rootId: string,
  remotePath: string,
  headers: Record<string, string>,
  total: number,
  sha256Hex: string,
): Promise<{ complete: boolean; offset: number }> {
  const response = await fetchScopedUpload(rootId, remotePath, getAccess, {
    headers,
    method: "HEAD",
  });
  const offset = Number(response.headers.get("x-upload-offset") ?? "0");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > total) {
    throw new Error("Host returned an invalid upload offset");
  }
  const complete = response.headers.get("x-upload-complete") === "true";
  if (complete && (offset !== total || response.headers.get("x-content-sha256") !== sha256Hex)) {
    throw new Error("Host returned invalid completed-upload metadata");
  }
  if (!complete && response.status !== 204 && response.status !== 404) {
    throw new Error(`Upload resume check failed (${String(response.status)})`);
  }
  return { complete, offset };
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function startDownload(
  getAccess: GetTransferAccess,
  directory: SelectedDirectory,
  rootId: string,
  remotePath: string,
  onProgress: (progress: TransferProgress) => void,
): RunningTransfer {
  return startDownloadFromUrl(
    getAccess,
    directory,
    { kind: "scoped", path: remotePath, rootId },
    remotePath,
    onProgress,
  );
}

export function startPreviewDownload(
  getAccess: GetTransferAccess,
  directory: SelectedDirectory,
  absolutePath: string,
  onProgress: (progress: TransferProgress) => void,
): RunningTransfer {
  if (!absolutePath.startsWith("/") || absolutePath.includes("\0")) {
    throw new Error("Preview download path must be absolute");
  }
  return startDownloadFromUrl(
    getAccess,
    directory,
    { kind: "path", path: absolutePath },
    absolutePath,
    onProgress,
  );
}

function startDownloadFromUrl(
  getAccess: GetTransferAccess,
  directory: SelectedDirectory,
  source: PrivateAssetSource,
  remotePath: string,
  onProgress: (progress: TransferProgress) => void,
): RunningTransfer {
  let cancelled = false;
  const isCancelled = (): boolean => cancelled;
  let activeRequest: AbortController | null = null;
  let destination: File | null = null;
  const promise = (async () => {
    const head = await fetchPrivateAsset(source, getAccess, { method: "HEAD" });
    if (!head.ok) {
      throw new Error(`Download metadata failed (${String(head.status)})`);
    }
    const expectedHash = head.headers.get("x-content-sha256");
    const expectedBytes = Number(head.headers.get("content-length"));
    if (
      expectedHash === null ||
      !/^[a-f0-9]{64}$/.test(expectedHash) ||
      !Number.isSafeInteger(expectedBytes)
    ) {
      throw new Error("Server did not provide valid integrity metadata");
    }
    const filename = safeFilename(remotePath);
    const partialName = `.codex-part-${expectedHash.slice(0, 16)}-${filename}`;
    const listedPartial = directory.native
      .list()
      .find((entry): entry is File => entry instanceof File && entry.name === partialName);
    destination =
      listedPartial ?? directory.native.createFile(partialName, head.headers.get("content-type"));
    if (destination.size > expectedBytes) {
      destination.delete();
      destination = directory.native.createFile(partialName, head.headers.get("content-type"));
    }
    let offset = destination.size;
    while (offset < expectedBytes) {
      if (isCancelled()) {
        throw new Error("Transfer cancelled");
      }
      const end = Math.min(expectedBytes - 1, offset + 4 * 1024 * 1024 - 1);
      let response: Response | null = null;
      for (let attempt = 0; attempt < 4 && response === null; attempt += 1) {
        activeRequest = new AbortController();
        try {
          response = await fetchPrivateAsset(source, getAccess, {
            headers: { range: `bytes=${String(offset)}-${String(end)}` },
            signal: activeRequest.signal,
          });
        } catch (error) {
          if (isCancelled()) {
            // WHY: Cancellation is authoritative, and the fetch error may contain a secret-bearing URL.
            // oxlint-disable-next-line preserve-caught-error
            throw new Error("Transfer cancelled");
          }
          if (attempt === 3) {
            throw error;
          }
          await delay(150 * 2 ** attempt);
        } finally {
          activeRequest = null;
        }
      }
      if (response === null) {
        throw new Error("Download request did not complete");
      }
      if (response.status !== 206) {
        throw new Error(`Download range failed (${String(response.status)})`);
      }
      if (response.headers.get("x-content-sha256") !== expectedHash) {
        throw new Error("Remote file changed during download");
      }
      const expectedRange = `bytes ${String(offset)}-${String(end)}/${String(expectedBytes)}`;
      if (response.headers.get("content-range") !== expectedRange) {
        throw new Error("Host returned an invalid download range");
      }
      const chunk = new Uint8Array(await response.arrayBuffer());
      if (chunk.length !== end - offset + 1) {
        throw new Error("Host returned an incomplete download range");
      }
      if (isCancelled()) {
        throw new Error("Transfer cancelled");
      }
      // SAF writes use ContentResolver.openOutputStream("wa") and close within
      // this call. Do not retain an Expo FileChannel across network awaits.
      destination.write(chunk, { append: true });
      offset += chunk.length;
      onProgress({ phase: "transferring", total: expectedBytes, transferred: offset });
    }
    if (isCancelled()) {
      throw new Error("Transfer cancelled");
    }
    onProgress({ phase: "verifying", total: expectedBytes, transferred: 0 });
    const actualHash = await hashFile(
      destination,
      (transferred) => {
        onProgress({ phase: "verifying", total: expectedBytes, transferred });
      },
      isCancelled,
    );
    if (actualHash !== expectedHash || destination.size !== expectedBytes) {
      destination.delete();
      throw new Error("Downloaded file failed SHA-256 integrity verification");
    }
    destination = await finalizeDownloadedFile(
      directory.native,
      destination,
      filename,
      head.headers.get("content-type"),
      expectedBytes,
      expectedHash,
      onProgress,
      isCancelled,
    );
    const mimeType = head.headers.get("content-type");
    return {
      bytes: expectedBytes,
      sha256: actualHash,
      uri: destination.uri,
      ...(mimeType === null ? {} : { mimeType }),
    };
  })();
  return {
    cancel() {
      cancelled = true;
      activeRequest?.abort();
    },
    promise,
  };
}

async function finalizeDownloadedFile(
  directory: Directory,
  partial: File,
  filename: string,
  mimeType: string | null,
  expectedBytes: number,
  expectedHash: string,
  onProgress: (progress: TransferProgress) => void,
  cancelled: () => boolean,
): Promise<File> {
  if (!partial.uri.startsWith("content://")) {
    partial.rename(filename);
    return partial;
  }

  const existing = directory.list().find((entry) => entry.name === filename);
  if (existing !== undefined) {
    if (existing instanceof File && existing.size === expectedBytes) {
      const existingHash = await hashFile(
        existing,
        (transferred) => {
          onProgress({ phase: "verifying", total: expectedBytes, transferred });
        },
        cancelled,
      );
      if (existingHash === expectedHash) {
        deleteBestEffort(partial);
        return existing;
      }
    }
    throw new Error(`A file named "${filename}" already exists in the selected folder`);
  }

  const completed = directory.createFile(filename, mimeType);
  if (completed.name !== filename) {
    deleteBestEffort(completed);
    throw new Error(`The selected folder could not create a file named "${filename}"`);
  }
  try {
    await copyFileContents(
      partial,
      completed,
      expectedBytes,
      expectedHash,
      (transferred) => {
        onProgress({ phase: "verifying", total: expectedBytes, transferred });
      },
      cancelled,
    );
  } catch (error) {
    deleteBestEffort(completed);
    throw error;
  }
  deleteBestEffort(partial);
  return completed;
}

async function copyFileContents(
  source: File,
  target: File,
  expectedBytes: number,
  expectedHash: string,
  progress: (bytes: number) => void,
  cancelled: () => boolean,
): Promise<void> {
  if (source.uri.startsWith("content://") || target.uri.startsWith("content://")) {
    if (!source.uri.startsWith("content://") || !target.uri.startsWith("content://")) {
      throw new Error(
        "Saving between app-private and selected storage is not supported by this runtime",
      );
    }
    if (cancelled()) {
      throw new Error("Transfer cancelled");
    }
    const copyContentDocument = fileTransferBridge?.copyContentDocument;
    if (copyContentDocument === undefined) {
      throw new Error("This download requires a newer CodeWide APK");
    }
    const copied = await copyContentDocument(source.uri, target.uri);
    if (cancelled()) {
      throw new Error("Transfer cancelled");
    }
    progress(copied.bytes);
    if (copied.bytes !== expectedBytes || copied.sha256 !== expectedHash) {
      throw new Error("Saved file failed SHA-256 integrity verification");
    }
    return;
  }
  const input = source.open(FileMode.ReadOnly);
  const output = target.open(FileMode.WriteOnly);
  let copied = 0;
  try {
    while (copied < expectedBytes) {
      if (cancelled()) {
        throw new Error("Transfer cancelled");
      }
      const chunk = input.readBytes(Math.min(1024 * 1024, expectedBytes - copied));
      if (chunk.length === 0) {
        throw new Error("Could not copy the complete downloaded file");
      }
      output.writeBytes(chunk);
      copied += chunk.length;
      progress(copied);
      if (copied % (8 * 1024 * 1024) === 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      }
    }
  } finally {
    input.close();
    output.close();
  }
  if (copied !== expectedBytes) {
    throw new Error("Could not copy the complete downloaded file");
  }
}

function deleteBestEffort(file: File): void {
  try {
    if (file.exists) {
      file.delete();
    }
  } catch {
    // The completed file is already durable. A provider-specific cleanup
    // failure must not turn a successful user-visible save into an error.
  }
}

async function hashFile(
  file: File,
  progress: (bytes: number) => void,
  cancelled: () => boolean,
): Promise<string> {
  if (file.uri.startsWith("content://")) {
    if (cancelled()) {
      throw new Error("Transfer cancelled");
    }
    const hashContentDocument = fileTransferBridge?.hashContentDocument;
    if (hashContentDocument === undefined) {
      throw new Error("This download requires a newer CodeWide APK");
    }
    const result = await hashContentDocument(file.uri);
    if (cancelled()) {
      throw new Error("Transfer cancelled");
    }
    progress(result.bytes);
    if (result.bytes !== file.size) {
      throw new Error("Could not read the complete file");
    }
    return result.sha256;
  }
  const hash = sha256.create();
  const handle = file.open();
  let read = 0;
  try {
    while (read < file.size) {
      if (cancelled()) {
        throw new Error("Transfer cancelled");
      }
      const chunk = handle.readBytes(Math.min(1024 * 1024, file.size - read));
      if (chunk.length === 0) {
        break;
      }
      hash.update(chunk);
      read += chunk.length;
      progress(read);
      if (read % (8 * 1024 * 1024) === 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      }
    }
  } finally {
    handle.close();
  }
  if (read !== file.size) {
    throw new Error("Could not read the complete file");
  }
  return bytesToHex(hash.digest());
}

function safeFilename(remotePath: string): string {
  const filename = remotePath.split("/").filter(Boolean).at(-1) ?? "download";
  if (filename === "." || filename === ".." || filename.includes("\0")) {
    throw new Error("Invalid remote filename");
  }
  return filename;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
