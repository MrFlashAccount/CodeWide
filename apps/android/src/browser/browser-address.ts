/** Resolves typed navigation without changing the tunnel's origin for relative paths. */
export function resolveBrowserAddress(input: string, currentUrl: string): string {
  const text = input.trim();
  if (text === "") throw new Error("Enter an address");
  let target: URL;
  try {
    if (/^(?:\/|\?|#|\.\.?\/)/u.test(text)) target = new URL(text, currentUrl);
    else if (/^https?:\/\//iu.test(text)) target = new URL(text);
    else {
      const hostWithPort = /^(?:localhost|[\w.-]+|\[[\da-f:]+\]):\d+(?:[/?#]|$)/iu.test(text);
      if (/^[a-z][a-z\d+.-]*:/iu.test(text) && !hostWithPort) throw new Error("Unsupported scheme");
      const local = /^(?:localhost|127\.\d+\.\d+\.\d+|\[::1\])(?::\d+)?(?:[/?#]|$)/iu.test(text);
      target = new URL(`${local ? "http" : "https"}://${text}`);
    }
  } catch { throw new Error("Enter a valid HTTP or HTTPS address"); }
  if ((target.protocol !== "http:" && target.protocol !== "https:") || target.hostname === "") throw new Error("Enter a valid HTTP or HTTPS address");
  return target.href;
}

/** Caller-provided tunnel credentials belong only to their original origin. */
export function browserAddressKeepsOrigin(originalUrl: string, targetUrl: string): boolean {
  try { return new URL(originalUrl).origin === new URL(targetUrl).origin; }
  catch { return false; }
}
