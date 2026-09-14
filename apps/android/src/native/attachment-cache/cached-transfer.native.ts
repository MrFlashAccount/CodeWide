import { checkAborted } from "../check-aborted";
import { AttachmentDiskCache, type AttachmentLease } from "./disk-cache";
import { AttachmentResponse } from "./attachment-response";
import type { ExpoAttachmentStorage } from "./storage.native";
import { attachmentMetadata, cachedResponseHeaders, type AttachmentMetadata } from "./http-metadata";
import type { CachedTransferOptions } from "./transfer-options";

let residentCache: AttachmentDiskCache | null = null;
let state: Promise<{ cache: AttachmentDiskCache; storage: ExpoAttachmentStorage }> | null = null;

function cacheState(): Promise<{ cache: AttachmentDiskCache; storage: ExpoAttachmentStorage }> {
  return state ??= import("./storage.native").then(({ ExpoAttachmentStorage }) => {
    const storage = new ExpoAttachmentStorage();
    const cache = new AttachmentDiskCache(storage, Date.now);
    residentCache = cache;
    return { cache, storage };
  });
}

async function digest(value: string): Promise<string> {
  const { CryptoDigestAlgorithm, digestStringAsync } = await import("expo-crypto");
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, value);
}

/** All attachment formats and ranges share the same disk budget. HEAD proves freshness. */
export async function cachedAttachmentFetch(uri: string, init: RequestInit, options: CachedTransferOptions): Promise<Response> {
  if ((init.method ?? "GET") !== "GET" || !/^https?:/u.test(uri)) return fetch(uri, init);
  const headers = new Headers(init.headers);
  const head = await fetch(uri, { method: "HEAD", headers: withoutRange(headers), ...(init.signal === undefined ? {} : { signal: init.signal }) });
  if (!head.ok) return head;
  const metadata = attachmentMetadata(head.headers, headers.get("range"));
  if (metadata === null) return fetch(uri, init);
  let lease: AttachmentLease | null;
  try {
    lease = await acquireDownload(uri, headers, options, metadata);
  } catch (cause) {
    if (cause instanceof AttachmentHttpError) return new Response(null, { status: cause.status });
    throw cause;
  }
  if (lease === null) return fetch(uri, init);
  try {
    if (init.signal != null) checkAborted(init.signal);
    const { File } = await import("expo-file-system");
    const bytes = await new File(lease.uri).arrayBuffer();
    if (init.signal != null) checkAborted(init.signal);
    return new AttachmentResponse(bytes, { status: metadata.ranged ? 206 : 200, headers: cachedResponseHeaders(metadata) });
  } finally {
    lease.release();
  }
}

/** A native player can stream when a file cannot fit without evicting active readers. */
export async function cachedAttachmentSource(uri: string, headers: Record<string, string>, options: CachedTransferOptions, signal?: AbortSignal): Promise<{ uri: string; headers: Record<string, string> }> {
  if (!/^https?:/u.test(uri)) return { uri, headers };
  const head = await fetch(uri, { method: "HEAD", headers, ...(signal === undefined ? {} : { signal }) });
  if (!head.ok) throw new Error(`Private attachment unavailable (${head.status})`);
  const metadata = attachmentMetadata(head.headers, null);
  if (metadata === null) return { uri, headers };
  const lease = await acquireDownload(uri, new Headers(headers), options, metadata);
  if (lease === null) return { uri, headers };
  retainUntilAbort(lease, signal);
  return { uri: lease.uri, headers: {} };
}

export function retainCachedAttachment(uri: string): () => void {
  return residentCache?.retain(uri) ?? (() => undefined);
}

export async function cacheInlineAttachment(uri: string, base64: string): Promise<string> {
  const { cache, storage } = await cacheState();
  const { deleteAsync, moveAsync, writeAsStringAsync } = await import("expo-file-system/legacy");
  const key = await digest(base64);
  const bytes = Math.floor(base64.length * 3 / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  const lease = await cache.acquire(key, bytes, async () => {
    const partial = `${storage.uri(key)}.partial`;
    try {
      await writeAsStringAsync(partial, base64, { encoding: "base64" });
      await moveAsync({ from: partial, to: storage.uri(key) });
    } finally {
      await deleteAsync(partial, { idempotent: true });
    }
  });
  if (lease === null) return uri;
  lease.release();
  return lease.uri;
}

async function acquireDownload(uri: string, headers: Headers, options: CachedTransferOptions, metadata: AttachmentMetadata): Promise<AttachmentLease | null> {
  // The namespace is independent of rotating session credentials and local transport ports.
  const { cache, storage } = await cacheState();
  const { deleteAsync, downloadAsync, getInfoAsync, moveAsync } = await import("expo-file-system/legacy");
  const key = await digest(JSON.stringify([
    options.scope, options.identity, metadata.revision, metadata.start, metadata.bytes,
  ]));
  return cache.acquire(key, metadata.bytes, async () => {
    const partial = `${storage.uri(key)}.partial`;
    try {
      const downloaded = await downloadAsync(uri, partial, { headers: Object.fromEntries(headers.entries()), cache: false });
      if (downloaded.status < 200 || downloaded.status >= 300) throw new AttachmentHttpError(downloaded.status);
      if (downloaded.status !== (metadata.ranged ? 206 : 200)) throw new Error("Attachment server did not honor the requested range");
      const received = new Headers(downloaded.headers);
      const revision = received.get("x-content-sha256") ?? received.get("etag");
      const info = await getInfoAsync(partial);
      if (revision !== metadata.revision || !info.exists || info.isDirectory || info.size !== metadata.bytes
        || (metadata.ranged && received.get("content-range") !== cachedResponseHeaders(metadata).get("content-range"))) {
        throw new Error("Attachment changed during download or was incomplete; retry opening it");
      }
      await moveAsync({ from: partial, to: storage.uri(key) });
    } finally {
      await deleteAsync(partial, { idempotent: true });
    }
  });
}

function withoutRange(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => { if (key !== "range") result[key] = value; });
  return result;
}

function retainUntilAbort(lease: AttachmentLease, signal: AbortSignal | undefined): void {
  if (signal === undefined || signal.aborted) lease.release();
  else signal.addEventListener("abort", lease.release, { once: true });
  if (signal !== undefined) checkAborted(signal);
}

class AttachmentHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Private attachment unavailable (${status})`);
    this.status = status;
  }
}
