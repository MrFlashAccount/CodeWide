import { checkAborted } from "../native/check-aborted";
import { recoverPrivateAsset } from "./private-asset-recovery";
import { materializePrivateImageUri } from "./private-image-cache";
import {
  cachedAttachmentSource,
  cachedAttachmentSourceFromResponse,
  retainCachedAttachment,
} from "../native/attachment-cache/cached-transfer";
import {
  resolvePrivateAssetRequest,
  type GetTransferAccess,
  type PrivateAssetImageVariant,
  type PrivateAssetSource,
} from "../data/private-transfer";

/**
 * One private asset pipeline for inline images, host paths, projected binary
 * tool results and remote HTTPS media. Cacheable sources share bounded
 * app-private storage; oversized media can stream with headers, and an expired
 * companion session is refreshed once at the transport boundary.
 */
export async function materializePrivateAsset(
  source: PrivateAssetSource,
  {
    getAccess,
    recoverMissing,
    signal,
    variant = "original",
  }: {
    getAccess: GetTransferAccess | null;
    recoverMissing?: (() => Promise<void>) | undefined;
    signal?: AbortSignal | undefined;
    variant?: PrivateAssetImageVariant | undefined;
  },
): Promise<{ headers: Record<string, string>; uri: string }> {
  if (source.kind === "direct") {
    return materializeDirectAsset(source, signal);
  }
  if (getAccess === null) {
    throw new Error("Private asset access is unavailable");
  }
  return recoverPrivateAsset(
    async (refresh) => {
      const request = await resolvePrivateAssetRequest(source, getAccess, {
        forceRefresh: refresh,
        imageVariant: variant,
      });
      const materializeSource =
        variant === "original" ? cachedAttachmentSource : cachedAttachmentSourceFromResponse;
      return materializeSource({
        headers: request.headers,
        options: { identity: request.cacheIdentity, scope: request.cacheScope },
        signal,
        uri: request.uri,
      });
    },
    source.kind === "content" ? (recoverMissing ?? null) : null,
  );
}

async function materializeDirectAsset(
  source: Extract<PrivateAssetSource, { kind: "direct" }>,
  signal: AbortSignal | undefined,
): Promise<{ headers: Record<string, string>; uri: string }> {
  if (/^https?:/u.test(source.uri)) {
    return cachedAttachmentSource({
      headers: source.headers ?? {},
      options: { identity: source.uri, scope: "direct" },
      signal,
      uri: source.uri,
    });
  }
  const uri = await materializePrivateImageUri(source.uri, source.headers);
  if (signal !== undefined) {
    checkAborted(signal);
    const release = retainCachedAttachment(uri);
    signal.addEventListener("abort", release, { once: true });
  }
  return { headers: {}, uri };
}
