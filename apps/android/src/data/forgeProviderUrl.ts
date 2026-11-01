/**
 * A provider-supplied URL (host-login verification page, Generate token link)
 * is opened only when it is `https` on the provider's declared host, without
 * credentials or a custom port. Anything else is never opened.
 */
export function safeProviderUrl(uri: string, host: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return null;
  }
  const expected = host.toLowerCase();
  return parsed.protocol === "https:" &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.port === "" &&
    parsed.hostname.toLowerCase() === expected
    ? parsed.toString()
    : null;
}
