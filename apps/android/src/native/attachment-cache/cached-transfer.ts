import type { CachedTransferOptions } from "./transfer-options";

/** Web/Node fallback keeps the existing transport; Android supplies a disk-backed adapter. */
export async function cachedAttachmentFetch(
  uri: string,
  init: RequestInit,
  _options: CachedTransferOptions,
): Promise<Response> {
  return fetch(uri, init);
}

export async function cachedAttachmentSource(
  uri: string,
  headers: Record<string, string>,
  _options: CachedTransferOptions,
  _signal?: AbortSignal,
): Promise<{ uri: string; headers: Record<string, string> }> {
  return { uri, headers };
}

export function retainCachedAttachment(_uri: string): () => void {
  return () => undefined;
}

export async function cacheInlineAttachment(uri: string, _base64: string): Promise<string> {
  return uri;
}
