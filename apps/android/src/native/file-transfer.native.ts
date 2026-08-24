import { sha256 } from "@noble/hashes/sha2.js";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import { Linking, NativeModules } from "react-native";

import {
  fetchPrivateAsset,
  fetchScopedUpload,
  type GetTransferAccess,
  type PrivateAssetSource,
} from "../data/private-transfer";

export type TransferProgress = { transferred: number; total: number; phase: "hashing" | "transferring" | "verifying" };
export type SelectedUpload = { name: string; size: number; mimeType: string; native: File };
export type SelectedDirectory = { name: string; native: Directory };
export type RunningTransfer = { promise: Promise<{ bytes: number; sha256: string; uri?: string; mimeType?: string }>; cancel(): void };

type FileTransferBridge = {
  openDocument?(uri: string, mimeType: string | null): Promise<void>;
  hashContentDocument?(uri: string): Promise<{ bytes: number; sha256: string }>;
  copyContentDocument?(sourceUri: string, targetUri: string): Promise<{ bytes: number; sha256: string }>;
};

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
  if (picked.canceled) return null;
  return { name: picked.result.name, size: picked.result.size, mimeType: picked.result.type || "application/octet-stream", native: picked.result };
}

export function createTextUpload(name: string, mimeType: string, source: string): SelectedUpload {
  const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "attachment.txt";
  const file = new File(Paths.cache, `codewide-${Date.now().toString(36)}-${safeName}`);
  file.create({ overwrite: true, intermediates: true });
  file.write(source);
  return { name: safeName, size: file.size, mimeType, native: file };
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
  let activeRequest: AbortController | null = null;
  const promise = (async () => {
    const hash = await hashFile(file.native, (transferred) => onProgress({ transferred, total: file.size, phase: "hashing" }), () => cancelled);
    if (cancelled) throw new Error("Transfer cancelled");
    const uploadId = `sha256-${hash}`;
    const commonHeaders = {
      "content-type": file.native.type || "application/octet-stream",
      "x-content-sha256": hash,
      "x-codex-overwrite": overwrite ? "true" : "false",
      "x-upload-id": uploadId,
    };
    let status = await uploadStatus(getAccess, rootId, remotePath, commonHeaders, file.size, hash);
    if (status.complete) return { bytes: file.size, sha256: hash };
    let offset = status.offset;
    const handle = file.native.open();
    let finalBody: { bytes: number; sha256: string } | null = null;
    try {
      handle.offset = offset;
      while (offset < file.size) {
        if (cancelled) throw new Error("Transfer cancelled");
        const chunk = handle.readBytes(Math.min(4 * 1024 * 1024, file.size - offset));
        if (chunk.length === 0) throw new Error("Could not read the complete upload file");
        const start = offset;
        const end = start + chunk.length - 1;
        let response: Response | null = null;
        for (let attempt = 0; attempt < 4 && response === null; attempt += 1) {
          const requestController = new AbortController();
          activeRequest = requestController;
          try {
            response = await fetchScopedUpload(rootId, remotePath, getAccess, {
              method: "PUT",
              headers: { ...commonHeaders, "content-range": `bytes ${start}-${end}/${file.size}` },
              body: chunk,
              signal: requestController.signal,
            });
          } catch (cause) {
            if (cancelled) throw new Error("Transfer cancelled");
            if (attempt === 3) throw cause;
            await delay(150 * (2 ** attempt));
            status = await uploadStatus(getAccess, rootId, remotePath, commonHeaders, file.size, hash);
            if (status.complete) return { bytes: file.size, sha256: hash };
            if (status.offset !== start) {
              offset = status.offset;
              handle.offset = offset;
              break;
            }
          } finally {
            activeRequest = null;
          }
        }
        if (offset !== start) continue;
        if (response === null) throw new Error("Upload request did not complete");
        const acknowledged = Number(response.headers.get("x-upload-offset") ?? end + 1);
        if (response.status === 409 && Number.isSafeInteger(acknowledged) && acknowledged >= 0 && acknowledged <= file.size && acknowledged !== start) {
          offset = acknowledged;
          handle.offset = offset;
          continue;
        }
        if (response.status === 308) {
          if (acknowledged !== end + 1) throw new Error("Host acknowledged an invalid upload offset");
          offset = acknowledged;
          onProgress({ transferred: offset, total: file.size, phase: "transferring" });
          continue;
        }
        const bodyText = await response.text();
        if (!response.ok) throw new Error(`Upload failed (${response.status}): ${bodyText.slice(0, 200)}`);
        finalBody = JSON.parse(bodyText) as { bytes: number; sha256: string };
        offset = file.size;
        onProgress({ transferred: offset, total: file.size, phase: "transferring" });
      }
    } finally {
      handle.close();
    }
    if (finalBody === null) {
      status = await uploadStatus(getAccess, rootId, remotePath, commonHeaders, file.size, hash);
      if (!status.complete) throw new Error("Host did not finalize the upload");
      finalBody = { bytes: file.size, sha256: hash };
    }
    const body = finalBody;
    if (body.sha256 !== hash || body.bytes !== file.size) throw new Error("Upload integrity response did not match the local file");
    return { bytes: body.bytes, sha256: body.sha256 };
  })();
  return {
    promise,
    cancel() {
      cancelled = true;
      activeRequest?.abort();
    },
  };
}

async function uploadStatus(
  getAccess: GetTransferAccess,
  rootId: string,
  remotePath: string,
  headers: Record<string, string>,
  total: number,
  sha256Hex: string,
): Promise<{ offset: number; complete: boolean }> {
  const response = await fetchScopedUpload(rootId, remotePath, getAccess, { method: "HEAD", headers });
  const offset = Number(response.headers.get("x-upload-offset") ?? "0");
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > total) throw new Error("Host returned an invalid upload offset");
  const complete = response.headers.get("x-upload-complete") === "true";
  if (complete && (offset !== total || response.headers.get("x-content-sha256") !== sha256Hex)) {
    throw new Error("Host returned invalid completed-upload metadata");
  }
  if (!complete && response.status !== 204 && response.status !== 404) throw new Error(`Upload resume check failed (${response.status})`);
  return { offset, complete };
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
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
    { kind: "scoped", rootId, path: remotePath },
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
  if (!absolutePath.startsWith("/") || absolutePath.includes("\0")) throw new Error("Preview download path must be absolute");
  return startDownloadFromUrl(getAccess, directory, { kind: "path", path: absolutePath }, absolutePath, onProgress);
}

function startDownloadFromUrl(
  getAccess: GetTransferAccess,
  directory: SelectedDirectory,
  source: PrivateAssetSource,
  remotePath: string,
  onProgress: (progress: TransferProgress) => void,
): RunningTransfer {
  let cancelled = false;
  let activeRequest: AbortController | null = null;
  let destination: File | null = null;
  const promise = (async () => {
    const head = await fetchPrivateAsset(source, getAccess, { method: "HEAD" });
    if (!head.ok) throw new Error(`Download metadata failed (${head.status})`);
    const expectedHash = head.headers.get("x-content-sha256");
    const expectedBytes = Number(head.headers.get("content-length"));
    if (expectedHash === null || !/^[a-f0-9]{64}$/.test(expectedHash) || !Number.isSafeInteger(expectedBytes)) throw new Error("Server did not provide valid integrity metadata");
    const filename = safeFilename(remotePath);
    const partialName = `.codex-part-${expectedHash.slice(0, 16)}-${filename}`;
    const listedPartial = directory.native.list().find((entry): entry is File => entry instanceof File && entry.name === partialName);
    destination = listedPartial ?? directory.native.createFile(partialName, head.headers.get("content-type"));
    if (destination.size > expectedBytes) {
      destination.delete();
      destination = directory.native.createFile(partialName, head.headers.get("content-type"));
    }
    let offset = destination.size;
    const handle = destination.open(FileMode.Append);
    try {
      while (offset < expectedBytes) {
        if (cancelled) throw new Error("Transfer cancelled");
        const end = Math.min(expectedBytes - 1, offset + 4 * 1024 * 1024 - 1);
        let response: Response | null = null;
        for (let attempt = 0; attempt < 4 && response === null; attempt += 1) {
          activeRequest = new AbortController();
          try {
            response = await fetchPrivateAsset(source, getAccess, {
              headers: { range: `bytes=${offset}-${end}` },
              signal: activeRequest.signal,
            });
          } catch (cause) {
            if (cancelled) throw new Error("Transfer cancelled");
            if (attempt === 3) throw cause;
            await delay(150 * (2 ** attempt));
          } finally {
            activeRequest = null;
          }
        }
        if (response === null) throw new Error("Download request did not complete");
        if (response.status !== 206) throw new Error(`Download range failed (${response.status})`);
        if (response.headers.get("x-content-sha256") !== expectedHash) throw new Error("Remote file changed during download");
        const expectedRange = `bytes ${offset}-${end}/${expectedBytes}`;
        if (response.headers.get("content-range") !== expectedRange) throw new Error("Host returned an invalid download range");
        const chunk = new Uint8Array(await response.arrayBuffer());
        if (chunk.length !== end - offset + 1) throw new Error("Host returned an incomplete download range");
        handle.writeBytes(chunk);
        offset += chunk.length;
        onProgress({ transferred: offset, total: expectedBytes, phase: "transferring" });
      }
    } finally {
      handle.close();
    }
    if (cancelled) throw new Error("Transfer cancelled");
    onProgress({ transferred: 0, total: expectedBytes, phase: "verifying" });
    const actualHash = await hashFile(destination, (transferred) => onProgress({ transferred, total: expectedBytes, phase: "verifying" }), () => cancelled);
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
      () => cancelled,
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
    promise,
    cancel() {
      cancelled = true;
      activeRequest?.abort();
    },
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
        (transferred) => onProgress({ transferred, total: expectedBytes, phase: "verifying" }),
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
      (transferred) => onProgress({ transferred, total: expectedBytes, phase: "verifying" }),
      cancelled,
    );
  } catch (cause) {
    deleteBestEffort(completed);
    throw cause;
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
      throw new Error("Saving between app-private and selected storage is not supported by this runtime");
    }
    if (cancelled()) throw new Error("Transfer cancelled");
    const copyContentDocument = fileTransferBridge?.copyContentDocument;
    if (copyContentDocument === undefined) {
      throw new Error("This download requires a newer CodeWide APK");
    }
    const copied = await copyContentDocument(source.uri, target.uri);
    if (cancelled()) throw new Error("Transfer cancelled");
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
      if (cancelled()) throw new Error("Transfer cancelled");
      const chunk = input.readBytes(Math.min(1024 * 1024, expectedBytes - copied));
      if (chunk.length === 0) throw new Error("Could not copy the complete downloaded file");
      output.writeBytes(chunk);
      copied += chunk.length;
      progress(copied);
      if (copied % (8 * 1024 * 1024) === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    input.close();
    output.close();
  }
  if (copied !== expectedBytes) throw new Error("Could not copy the complete downloaded file");
}

function deleteBestEffort(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // The completed file is already durable. A provider-specific cleanup
    // failure must not turn a successful user-visible save into an error.
  }
}

async function hashFile(file: File, progress: (bytes: number) => void, cancelled: () => boolean): Promise<string> {
  if (file.uri.startsWith("content://")) {
    if (cancelled()) throw new Error("Transfer cancelled");
    const hashContentDocument = fileTransferBridge?.hashContentDocument;
    if (hashContentDocument === undefined) {
      throw new Error("This download requires a newer CodeWide APK");
    }
    const result = await hashContentDocument(file.uri);
    if (cancelled()) throw new Error("Transfer cancelled");
    progress(result.bytes);
    if (result.bytes !== file.size) throw new Error("Could not read the complete file");
    return result.sha256;
  }
  const hash = sha256.create();
  const handle = file.open();
  let read = 0;
  try {
    while (read < file.size) {
      if (cancelled()) throw new Error("Transfer cancelled");
      const chunk = handle.readBytes(Math.min(1024 * 1024, file.size - read));
      if (chunk.length === 0) break;
      hash.update(chunk);
      read += chunk.length;
      progress(read);
      if (read % (8 * 1024 * 1024) === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    handle.close();
  }
  if (read !== file.size) throw new Error("Could not read the complete file");
  return bytesToHex(hash.digest());
}

function safeFilename(remotePath: string): string {
  const filename = remotePath.split("/").filter(Boolean).at(-1) ?? "download";
  if (filename === "." || filename === ".." || filename.includes("\0")) throw new Error("Invalid remote filename");
  return filename;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
