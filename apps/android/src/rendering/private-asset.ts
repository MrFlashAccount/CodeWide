import { materializePrivateImageUri } from "./private-image-cache";
import {
  resolvePrivateAssetRequest,
  type GetTransferAccess,
  type PrivateAssetSource,
} from "../data/private-transfer";

/**
 * One private asset pipeline for inline images, host paths, projected binary
 * tool results and remote HTTPS media. Every authenticated source is copied to
 * app-private storage before React Native Image sees it, and an expired
 * companion session is refreshed once at the transport boundary.
 */
export async function materializePrivateAsset(
  source: PrivateAssetSource,
  getAccess: GetTransferAccess | null,
  recoverMissing?: () => Promise<void>,
): Promise<string> {
  if (source.kind === "direct") return await materializePrivateImageUri(source.uri, source.headers);
  if (getAccess === null) throw new Error("Private asset access is unavailable");
  let refreshedAuthorization = false;
  let recoveredMissingContent = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const request = await resolvePrivateAssetRequest(source, getAccess, refreshedAuthorization);
      return await materializePrivateImageUri(request.uri, request.headers);
    } catch (cause) {
      if (!refreshedAuthorization && isAuthorizationFailure(cause)) {
        refreshedAuthorization = true;
        continue;
      }
      if (
        !recoveredMissingContent
        && source.kind === "content"
        && recoverMissing !== undefined
        && isMissingContent(cause)
      ) {
        recoveredMissingContent = true;
        await recoverMissing();
        continue;
      }
      throw cause;
    }
  }
  throw new Error("Private asset could not be materialized");
}

function isAuthorizationFailure(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /\((?:401|403)\)/u.test(message) || /unauthori[sz]ed|forbidden|session.*expired/iu.test(message);
}

function isMissingContent(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /\b404\b/u.test(message) || /content[_ ]not[_ ]found/iu.test(message);
}
