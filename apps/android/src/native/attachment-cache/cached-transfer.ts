import type { CompanionTransport, CompanionTransportInit } from "../companionTransportContract";
import type {
  CachedSourceRequest,
  CachedTransferOptions,
  DirectImageRequest,
  DirectImageResult,
} from "./transfer-options";

/** Web/Node fallback keeps the existing transport; Android supplies a disk-backed adapter. */
export async function cachedAttachmentFetch({
  init,
  transport,
  uri,
}: {
  init: CompanionTransportInit;
  options: CachedTransferOptions;
  transport: CompanionTransport;
  uri: string;
}): Promise<Response> {
  const response = await transport.fetch(uri, init);
  return response;
}

export async function cachedAttachmentSource({
  headers,
  transport,
  uri,
}: CachedSourceRequest): Promise<{ headers: Record<string, string>; uri: string }> {
  return transport.streamSource(uri, headers);
}

/** Web can decode the authenticated response directly; Android overrides this
 * with a one-GET local-file materialization for transformed images. */
export async function cachedAttachmentSourceFromResponse({
  headers,
  transport,
  uri,
}: CachedSourceRequest): Promise<{ headers: Record<string, string>; uri: string }> {
  return transport.streamSource(uri, headers);
}

/** Web and Node have no disk cache: a live URL is used as is, an expired one is missing. */
export async function cachedDirectImage(request: DirectImageRequest): Promise<DirectImageResult> {
  await Promise.resolve();
  return request.uri === null ? { status: "missing" } : { status: "ready", uri: request.uri };
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
