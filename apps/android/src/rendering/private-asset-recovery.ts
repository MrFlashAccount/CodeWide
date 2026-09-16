/** Retries expired authorization once and optionally restores missing immutable content once. */
export async function recoverPrivateAsset(
  materialize: (refresh: boolean) => Promise<{ headers: Record<string, string>; uri: string }>,
  recoverMissing: (() => Promise<void>) | null,
): Promise<{ headers: Record<string, string>; uri: string }> {
  let refreshedAuthorization = false;
  let recoveredMissingContent = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await materialize(refreshedAuthorization);
    } catch (error) {
      if (!refreshedAuthorization && isAuthorizationFailure(error)) {
        refreshedAuthorization = true;
        continue;
      }
      if (!recoveredMissingContent && recoverMissing !== null && isMissingContent(error)) {
        recoveredMissingContent = true;
        await recoverMissing();
        continue;
      }
      throw error;
    }
  }
  throw new Error("Private asset could not be materialized");
}

function isAuthorizationFailure(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return (
    /\((?:401|403)\)/u.test(message) || /unauthori[sz]ed|forbidden|session.*expired/iu.test(message)
  );
}

function isMissingContent(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /\b404\b/u.test(message) || /content[_ ]not[_ ]found/iu.test(message);
}
