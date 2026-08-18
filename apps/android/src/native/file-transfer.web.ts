export type { TransferAccess } from "../data/private-transfer";
export type TransferProgress = { transferred: number; total: number; phase: "hashing" | "transferring" | "verifying" };
export type SelectedUpload = { name: string; size: number; mimeType: string; native: unknown };
export type SelectedDirectory = { name: string; native: unknown };
export type RunningTransfer = { promise: Promise<{ bytes: number; sha256: string; uri?: string }>; cancel(): void };

export async function pickUploadFile(): Promise<SelectedUpload | null> { throw new Error("File transfer is available in the Android build"); }
export function createTextUpload(name: string, mimeType: string, source: string): SelectedUpload {
  const bytes = new TextEncoder().encode(source);
  return { name, size: bytes.byteLength, mimeType, native: source };
}
export async function pickDownloadDirectory(): Promise<SelectedDirectory> { throw new Error("File transfer is available in the Android build"); }
export function startUpload(): RunningTransfer { throw new Error("File transfer is available in the Android build"); }
export function startDownload(): RunningTransfer { throw new Error("File transfer is available in the Android build"); }
export function startPreviewDownload(): RunningTransfer { throw new Error("File transfer is available in the Android build"); }
