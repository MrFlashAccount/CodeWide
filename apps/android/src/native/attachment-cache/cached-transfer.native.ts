import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";

import { checkAborted } from "../check-aborted";
import type { CompanionTransport, CompanionTransportInit } from "../companionTransportContract";
import { AttachmentDiskCache, type AttachmentLease } from "./disk-cache";
import { AttachmentResponse } from "./attachment-response";
import type { ExpoAttachmentStorage } from "./storage.native";
import {
  attachmentMetadata,
  cachedResponseHeaders,
  type AttachmentMetadata,
} from "./http-metadata";
import type { CachedSourceRequest, CachedTransferOptions } from "./transfer-options";

let residentCache: AttachmentDiskCache | null = null;
let state: Promise<{ cache: AttachmentDiskCache; storage: ExpoAttachmentStorage }> | null = null;
let responseDownloadSequence = 0;

async function cacheState(): Promise<{
  cache: AttachmentDiskCache;
  storage: ExpoAttachmentStorage;
}> {
  return (state ??= import("./storage.native").then(({ ExpoAttachmentStorage }) => {
    const storage = new ExpoAttachmentStorage();
    const cache = new AttachmentDiskCache(storage, Date.now);
    residentCache = cache;
    return { cache, storage };
  }));
}

async function digest(value: string): Promise<string> {
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, value);
}

/** All attachment formats and ranges share the same disk budget. HEAD proves freshness. */
export async function cachedAttachmentFetch({
  init,
  options,
  transport,
  uri,
}: {
  init: CompanionTransportInit;
  options: CachedTransferOptions;
  transport: CompanionTransport;
  uri: string;
}): Promise<Response> {
  if ((init.method ?? "GET") !== "GET") {
    return transport.fetch(uri, init);
  }
  const headers = new Headers(init.headers);
  const head = await transport.fetch(uri, {
    headers: withoutRange(headers),
    method: "HEAD",
    ...(init.signal === undefined ? {} : { signal: init.signal }),
  });
  if (!head.ok) {
    return head;
  }
  const metadata = attachmentMetadata(head.headers, headers.get("range"));
  if (metadata === null) {
    return uncachedResponse(transport, uri, headers, init.signal);
  }
  let lease: AttachmentLease | null;
  try {
    lease = await acquireDownload({ headers, metadata, options, transport, uri });
  } catch (error) {
    if (error instanceof AttachmentHttpError) {
      return new Response(null, { status: error.status });
    }
    throw error;
  }
  if (lease === null) {
    return uncachedResponse(transport, uri, headers, init.signal);
  }
  try {
    return await fileResponse(lease.uri, init.signal, {
      headers: cachedResponseHeaders(metadata),
      status: metadata.ranged ? 206 : 200,
    });
  } finally {
    lease.release();
  }
}

/** Reads a body that cannot enter the cache through a transient file, so binary bytes never pass
 * through a text bridge and the cache budget stays untouched. */
async function uncachedResponse(
  transport: CompanionTransport,
  uri: string,
  headers: Headers,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const [{ storage }, fileSystem, key] = await Promise.all([
    cacheState(),
    import("expo-file-system/legacy"),
    digest(`uncached:${uri}:${String(Date.now())}:${String(Math.random())}`),
  ]);
  const partial = `${storage.uri(key)}.partial`;
  try {
    const downloaded = await transport.download(
      uri,
      { headers: Object.fromEntries(headers.entries()), signal },
      { append: false, uri: partial },
    );
    if (!new Response(null, { status: downloaded.status }).ok) {
      return new Response(null, { headers: downloaded.headers, status: downloaded.status });
    }
    return await fileResponse(partial, signal, {
      headers: downloaded.headers,
      status: downloaded.status,
    });
  } finally {
    await fileSystem.deleteAsync(partial, { idempotent: true });
  }
}

async function fileResponse(
  uri: string,
  signal: AbortSignal | undefined,
  init: { headers: Headers; status: number },
): Promise<Response> {
  checkOptionalAbort(signal);
  const { File } = await import("expo-file-system");
  const bytes = await new File(uri).arrayBuffer();
  checkOptionalAbort(signal);
  return new AttachmentResponse(bytes, init);
}

/** A native player can stream when a file cannot fit without evicting active readers. */
export async function cachedAttachmentSource(
  request: CachedSourceRequest,
): Promise<{ headers: Record<string, string>; uri: string }> {
  const { headers, options, signal, transport, uri } = request;
  if (!/^https?:/u.test(uri)) {
    return { headers, uri };
  }
  const head = await transport.fetch(uri, {
    headers,
    method: "HEAD",
    ...(signal === undefined ? {} : { signal }),
  });
  if (!head.ok) {
    throw new AttachmentHttpError(head.status);
  }
  const metadata = attachmentMetadata(head.headers, null);
  if (metadata === null) {
    return transport.streamSource(uri, headers);
  }
  const lease = await acquireDownload({
    headers: new Headers(headers),
    metadata,
    options,
    transport,
    uri,
  });
  if (lease === null) {
    return transport.streamSource(uri, headers);
  }
  retainUntilAbort(lease, signal);
  return { headers: {}, uri: lease.uri };
}

/** Downloads a transformed image once, then derives its durable cache key from
 * the response ETag. Unlike mutable original files, this path needs no HEAD probe. */
export async function cachedAttachmentSourceFromResponse(
  request: CachedSourceRequest,
): Promise<{ headers: Record<string, string>; uri: string }> {
  const { headers, options, signal, transport, uri } = request;
  if (!/^https?:/u.test(uri)) {
    return { headers, uri };
  }
  checkOptionalAbort(signal);
  const sequence = responseDownloadSequence;
  responseDownloadSequence += 1;
  const [{ cache, storage }, fileSystem, provisionalKey, scopeKey] = await Promise.all([
    cacheState(),
    import("expo-file-system/legacy"),
    digest(JSON.stringify([options.scope, options.identity, sequence])),
    attachmentScopeKey(options.scope),
  ]);
  await cache.ready();
  const { deleteAsync, getInfoAsync, moveAsync } = fileSystem;
  const partial = `${storage.uri(provisionalKey)}.partial`;
  try {
    const downloaded = await transport.download(
      uri,
      { headers, signal },
      { append: false, uri: partial },
    );
    checkOptionalAbort(signal);
    const info = await getInfoAsync(partial);
    const metadata = responseDownloadMetadata(downloaded, info);
    const key = await digest(
      JSON.stringify([
        options.scope,
        options.identity,
        metadata.revision,
        metadata.start,
        metadata.bytes,
      ]),
    );
    const lease = await cache.acquire(key, { bytes: metadata.bytes, scopeKey }, async () => {
      await moveAsync({ from: partial, to: storage.uri(key) });
    });
    if (lease === null) {
      return await transport.streamSource(uri, headers);
    }
    retainUntilAbort(lease, signal);
    return { headers: {}, uri: lease.uri };
  } finally {
    await deleteAsync(partial, { idempotent: true });
  }
}

function checkOptionalAbort(signal: AbortSignal | undefined): void {
  if (signal !== undefined) {
    checkAborted(signal);
  }
}

function responseDownloadMetadata(
  downloaded: { headers: Headers; status: number },
  info: { exists: boolean; isDirectory?: boolean; size?: number },
): AttachmentMetadata {
  if (!new Response(null, { status: downloaded.status }).ok) {
    throw new AttachmentHttpError(downloaded.status);
  }
  const metadata = attachmentMetadata(downloaded.headers, null);
  if (metadata === null) {
    throw new Error("Transformed image response had no stable revision");
  }
  if (![info.exists, info.isDirectory === false, info.size === metadata.bytes].every(Boolean)) {
    throw new Error("Transformed image response was incomplete");
  }
  return metadata;
}

export function retainCachedAttachment(uri: string): () => void {
  return residentCache?.retain(uri) ?? (() => undefined);
}

/** Removes a deleted connection's cached attachments, including legacy unowned files. */
export async function purgeCachedConnectionAttachments(connectionId: string): Promise<void> {
  const [{ cache }, scopeKey] = await Promise.all([cacheState(), digest(connectionId)]);
  await cache.deleteScope(scopeKey);
}

async function attachmentScopeKey(scope: string): Promise<string | undefined> {
  return scope === "direct" ? undefined : digest(scope);
}

export async function cacheInlineAttachment(uri: string, base64: string): Promise<string> {
  const [state, fileSystem, key] = await Promise.all([
    cacheState(),
    import("expo-file-system/legacy"),
    digest(base64),
  ]);
  const { cache, storage } = state;
  const { deleteAsync, moveAsync, writeAsStringAsync } = fileSystem;
  const bytes =
    Math.floor((base64.length * 3) / 4) -
    (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  const lease = await cache.acquire(key, { bytes, scopeKey: undefined }, async () => {
    const partial = `${storage.uri(key)}.partial`;
    try {
      await writeAsStringAsync(partial, base64, { encoding: "base64" });
      await moveAsync({ from: partial, to: storage.uri(key) });
    } finally {
      await deleteAsync(partial, { idempotent: true });
    }
  });
  if (lease === null) {
    return uri;
  }
  lease.release();
  return lease.uri;
}

async function acquireDownload({
  headers,
  metadata,
  options,
  transport,
  uri,
}: {
  headers: Headers;
  metadata: AttachmentMetadata;
  options: CachedTransferOptions;
  transport: CompanionTransport;
  uri: string;
}): Promise<AttachmentLease | null> {
  // The namespace is independent of rotating session credentials and local transport ports.
  const [state, fileSystem, key, scopeKey] = await Promise.all([
    cacheState(),
    import("expo-file-system/legacy"),
    digest(
      JSON.stringify([
        options.scope,
        options.identity,
        metadata.revision,
        metadata.start,
        metadata.bytes,
      ]),
    ),
    attachmentScopeKey(options.scope),
  ]);
  const { cache, storage } = state;
  const { deleteAsync, getInfoAsync, moveAsync } = fileSystem;
  return cache.acquire(key, { bytes: metadata.bytes, scopeKey }, async () => {
    const partial = `${storage.uri(key)}.partial`;
    try {
      const downloaded = await transport.download(
        uri,
        { headers: Object.fromEntries(headers.entries()) },
        { append: false, uri: partial },
      );
      if (downloaded.status < 200 || downloaded.status >= 300) {
        throw new AttachmentHttpError(downloaded.status);
      }
      if (downloaded.status !== (metadata.ranged ? 206 : 200)) {
        throw new Error("Attachment server did not honor the requested range");
      }
      const received = downloaded.headers;
      const revision = received.get("x-content-sha256") ?? received.get("etag");
      const info = await getInfoAsync(partial);
      if (
        revision !== metadata.revision ||
        !info.exists ||
        info.isDirectory ||
        info.size !== metadata.bytes ||
        (metadata.ranged &&
          received.get("content-range") !== cachedResponseHeaders(metadata).get("content-range"))
      ) {
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
  headers.forEach((value, key) => {
    if (key !== "range") {
      result[key] = value;
    }
  });
  return result;
}

function retainUntilAbort(lease: AttachmentLease, signal: AbortSignal | undefined): void {
  if (signal === undefined || signal.aborted) {
    lease.release();
  } else {
    signal.addEventListener("abort", lease.release, { once: true });
  }
  if (signal !== undefined) {
    checkAborted(signal);
  }
}

class AttachmentHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Private attachment unavailable (${String(status)})`);
    this.status = status;
  }
}
