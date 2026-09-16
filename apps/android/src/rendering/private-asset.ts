import { checkAborted } from "../native/check-aborted";
import { recoverPrivateAsset } from "./private-asset-recovery";
import { materializePrivateImageUri } from "./private-image-cache";
import {
  cachedAttachmentSource,
  retainCachedAttachment,
} from "../native/attachment-cache/cached-transfer";
import {
  resolvePrivateAssetRequest,
  type GetTransferAccess,
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
  getAccess: GetTransferAccess | null,
  recoverMissing?: () => Promise<void>,
  signal?: AbortSignal,
): Promise<{ headers: Record<string, string>; uri: string }> {
  if (source.kind === "direct") {
    if (/^https?:/u.test(source.uri)) {
      return cachedAttachmentSource(
        source.uri,
        source.headers ?? {},
        { identity: source.uri, scope: "direct" },
        signal,
      );
    }
    const uri = await materializePrivateImageUri(source.uri, source.headers);
    if (signal !== undefined) {
      checkAborted(signal);
      const release = retainCachedAttachment(uri);
      signal.addEventListener("abort", release, { once: true });
    }
    return { headers: {}, uri };
  }
  if (getAccess === null) {
    throw new Error("Private asset access is unavailable");
  }
  return recoverPrivateAsset(
    async (refresh) => {
      const request = await resolvePrivateAssetRequest(source, getAccess, refresh);
      return cachedAttachmentSource(
        request.uri,
        request.headers,
        { identity: request.cacheIdentity, scope: request.cacheScope },
        signal,
      );
    },
    source.kind === "content" ? (recoverMissing ?? null) : null,
  );
}
