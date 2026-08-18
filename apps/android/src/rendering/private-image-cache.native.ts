import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import {
  cacheDirectory,
  deleteAsync,
  downloadAsync,
  getInfoAsync,
  makeDirectoryAsync,
  moveAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";

import { inlineImagePayload } from "./image-source";

// v2 only contains files atomically published after a complete write/download.
// The old cache could retain a non-empty partial file after a network failure
// and subsequently hand that corrupt image to the fullscreen viewer forever.
const CACHE_DIRECTORY_NAME = "codex-remote-private-images-v2";
const materializations = new Map<string, Promise<string>>();

export async function materializePrivateImageUri(uri: string, headers?: Record<string, string>): Promise<string> {
  const payload = inlineImagePayload(uri);
  if (payload === null && headers === undefined) return uri;
  if (cacheDirectory === null) throw new Error("Private image cache is unavailable");

  const directory = `${cacheDirectory}${CACHE_DIRECTORY_NAME}/`;
  const cacheKey = payload === null ? uri : payload.base64;
  const digest = await digestStringAsync(CryptoDigestAlgorithm.SHA256, cacheKey);
  const extension = payload?.extension ?? imageExtension(uri);
  const fileUri = `${directory}${digest}.${extension}`;
  const partialUri = `${fileUri}.partial`;
  const pending = materializations.get(fileUri);
  if (pending !== undefined) return pending;

  const materialization = (async () => {
    const existing = await getInfoAsync(fileUri);
    if (existing.exists && (existing.size ?? 0) > 0) return fileUri;
    await makeDirectoryAsync(directory, { intermediates: true });
    await deleteAsync(partialUri, { idempotent: true });
    try {
      if (payload !== null) {
        await writeAsStringAsync(partialUri, payload.base64, { encoding: "base64" });
      } else {
        const downloaded = await downloadAsync(uri, partialUri, headers === undefined ? {} : { headers });
        if (downloaded.status < 200 || downloaded.status >= 300) {
          throw new Error(`Private image download failed (${downloaded.status})`);
        }
      }
      await moveAsync({ from: partialUri, to: fileUri });
      return fileUri;
    } finally {
      // A rejected request, process cancellation or interrupted write must
      // never become a cache hit on the next preview attempt.
      await deleteAsync(partialUri, { idempotent: true });
    }
  })();
  materializations.set(fileUri, materialization);
  try {
    return await materialization;
  } finally {
    materializations.delete(fileUri);
  }
}

function imageExtension(uri: string): "avif" | "gif" | "jpg" | "png" | "webp" {
  try {
    const parsed = new URL(uri);
    const sourcePath = parsed.searchParams.get("path") ?? parsed.pathname;
    const match = /\.([a-zA-Z0-9]+)$/u.exec(sourcePath);
    const extension = match?.[1]?.toLowerCase();
    if (extension === "jpeg" || extension === "jpg") return "jpg";
    if (extension === "avif" || extension === "gif" || extension === "png" || extension === "webp") return extension;
  } catch {
    // Android decodes image bytes independently of the cache file extension.
  }
  return "jpg";
}
