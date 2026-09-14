/** Retries expired authorization once and optionally restores missing immutable content once. */
export async function recoverPrivateAsset(
  materialize: (refresh: boolean) => Promise<{ uri: string; headers: Record<string, string> }>,
  recoverMissing: (() => Promise<void>) | null,
): Promise<{ uri: string; headers: Record<string, string> }> {
  let refreshedAuthorization = false;
  let recoveredMissingContent = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await materialize(refreshedAuthorization);
    } catch (cause) {
      if (!refreshedAuthorization && isAuthorizationFailure(cause)) {
        refreshedAuthorization = true;
        continue;
      }
      if (
        !recoveredMissingContent
        && recoverMissing !== null
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
