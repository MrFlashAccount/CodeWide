/** Builds a Companion HTTP URL without discarding an Android loopback capability prefix. */
export function companionHttpUrl(endpoint: string, path: string): string {
  if (!path.startsWith("/")) throw new Error("Companion HTTP path must be absolute");
  const url = new URL(endpoint);
  const protocol = url.protocol === "wss:" ? "https:" : url.protocol === "ws:" ? "http:" : url.protocol;
  const basePath = url.pathname.replace(/\/+$/u, "");
  // Preserve URL.pathname assignment semantics: query/fragment markers belong
  // to the path, and a leading double slash cannot replace the authority.
  const pathname = `${basePath}${path}`.replace(/[?#]/gu, encodeURIComponent);
  const credentials = url.username === "" && url.password === "" ? "" : `${url.username}${url.password === "" ? "" : `:${url.password}`}@`;
  return new URL(`${protocol}//${credentials}${url.host}${pathname}`).toString();
}
