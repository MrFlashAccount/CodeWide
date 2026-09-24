import type { CachedSourceRequest, CachedTransferOptions } from "./transfer-options";

/** Web/Node fallback keeps the existing transport; Android supplies a disk-backed adapter. */
export async function cachedAttachmentFetch(
  uri: string,
  init: RequestInit,
  _options: CachedTransferOptions,
): Promise<Response> {
  const response = await fetch(uri, init);
  return response;
}

export async function cachedAttachmentSource({
  headers,
  uri,
}: CachedSourceRequest): Promise<{ headers: Record<string, string>; uri: string }> {
  await Promise.resolve();
  return { headers, uri };
}

/** Web can decode the authenticated response directly; Android overrides this
 * with a one-GET local-file materialization for transformed images. */
export async function cachedAttachmentSourceFromResponse({
  headers,
  uri,
}: CachedSourceRequest): Promise<{ headers: Record<string, string>; uri: string }> {
  await Promise.resolve();
  return { headers, uri };
}

export function retainCachedAttachment(_uri: string): () => void {
  return () => undefined;
}

export async function cacheInlineAttachment(uri: string, _base64: string): Promise<string> {
  await Promise.resolve();
  return uri;
}

export async function purgeCachedConnectionAttachments(_connectionId: string): Promise<void> {
  await Promise.resolve();
}
