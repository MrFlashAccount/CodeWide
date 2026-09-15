import type { GetTransferAccess } from "../data/private-transfer";

export type { TransferAccess } from "../data/private-transfer";
export type TransferProgress = {
  transferred: number;
  total: number;
  phase: "hashing" | "transferring" | "verifying";
};
export type SelectedUpload = { name: string; size: number; mimeType: string; native: unknown };
export type SelectedDirectory = { name: string; native: unknown };
export function selectedUploadUri(_upload: SelectedUpload): string | null {
  return null;
}
export async function selectedUploadText(upload: SelectedUpload): Promise<string | null> {
  return typeof upload.native === "string" ? upload.native.slice(0, 512) : null;
}
export type RunningTransfer = {
  promise: Promise<{ bytes: number; sha256: string; uri?: string; mimeType?: string }>;
  cancel(): void;
};

export async function pickUploadFile(): Promise<SelectedUpload | null> {
  throw new Error("File transfer is available in the Android build");
}
export function createTextUpload(name: string, mimeType: string, source: string): SelectedUpload {
  const bytes = new TextEncoder().encode(source);
  return { name, size: bytes.byteLength, mimeType, native: source };
}
export function createBinaryUpload(
  name: string,
  mimeType: string,
  source: Uint8Array,
): SelectedUpload {
  return { name, size: source.byteLength, mimeType, native: source };
}
export async function pickDownloadDirectory(): Promise<SelectedDirectory> {
  throw new Error("File transfer is available in the Android build");
}
export async function openDownloadedFile(_uri: string, _mimeType?: string): Promise<void> {
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
