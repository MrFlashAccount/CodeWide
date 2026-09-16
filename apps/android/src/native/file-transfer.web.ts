import type { GetTransferAccess } from "../data/private-transfer";

export type { TransferAccess } from "../data/private-transfer";
export type TransferProgress = {
  phase: "hashing" | "transferring" | "verifying";
  total: number;
  transferred: number;
};
export type SelectedUpload = { mimeType: string; name: string; native: unknown; size: number };
export type SelectedDirectory = { name: string; native: unknown };
export function selectedUploadUri(_upload: SelectedUpload): string | null {
  return null;
}
export async function selectedUploadText(upload: SelectedUpload): Promise<string | null> {
  await Promise.resolve();
  return typeof upload.native === "string" ? upload.native.slice(0, 512) : null;
}
export type RunningTransfer = {
  cancel: () => void;
  promise: Promise<{ bytes: number; mimeType?: string; sha256: string; uri?: string }>;
};

export async function pickUploadFile(): Promise<SelectedUpload | null> {
  await Promise.resolve();
  throw new Error("File transfer is available in the Android build");
}
export function createTextUpload(name: string, mimeType: string, source: string): SelectedUpload {
  const bytes = new TextEncoder().encode(source);
  return { mimeType, name, native: source, size: bytes.byteLength };
}
export function createBinaryUpload(
  name: string,
  mimeType: string,
  source: Uint8Array,
): SelectedUpload {
  return { mimeType, name, native: source, size: source.byteLength };
}
export async function pickDownloadDirectory(): Promise<SelectedDirectory> {
  await Promise.resolve();
  throw new Error("File transfer is available in the Android build");
}
export async function openDownloadedFile(_uri: string, _mimeType?: string): Promise<void> {
  await Promise.resolve();
  throw new Error("Opening downloaded files is available in the Android build");
}
export function startUpload(
  _getAccess: GetTransferAccess,
  _file: SelectedUpload,
  _rootId: string,
  _remotePath: string,
  _overwrite: boolean,
  _onProgress: (progress: TransferProgress) => void,
): RunningTransfer {
  throw new Error("File transfer is available in the Android build");
}
export function startDownload(
  _getAccess: GetTransferAccess,
  _directory: SelectedDirectory,
  _rootId: string,
  _remotePath: string,
  _onProgress: (progress: TransferProgress) => void,
): RunningTransfer {
  throw new Error("File transfer is available in the Android build");
}
export function startPreviewDownload(
  _getAccess: GetTransferAccess,
  _directory: SelectedDirectory,
  _absolutePath: string,
  _onProgress: (progress: TransferProgress) => void,
): RunningTransfer {
  throw new Error("File transfer is available in the Android build");
}
