import type { PullRequestOverview } from "./forgePullRequestContract";

function credentialFreeHttpsUrl(uri: string): URL | null {
  try {
    const url = new URL(uri);
    return url.protocol === "https:" && url.username === "" && url.password === "" ? url : null;
  } catch {
    return null;
  }
}

/**
 * The Companion admits a PR page on the account host or a web host declared by its plugin.
 * A rejected page arrives as an empty string. Check the URL shape on use, including for
 * restored overviews which bypass the wire decoder.
 */
export function pullRequestPageUrl(overview: Pick<PullRequestOverview, "webUrl">): string | null {
  return credentialFreeHttpsUrl(overview.webUrl)?.href ?? null;
}

/**
 * A provider-supplied URL (host-login verification page, Generate token link)
 * is opened only when it is `https` on the provider's declared host, without
 * credentials or a custom port. Anything else is never opened.
 */
export function safeProviderUrl(uri: string, host: string): string | null {
  const parsed = credentialFreeHttpsUrl(uri);
  return parsed !== null &&
    parsed.port === "" &&
    parsed.hostname.toLowerCase() === host.toLowerCase()
    ? parsed.toString()
    : null;
}
