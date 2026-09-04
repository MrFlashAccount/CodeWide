/** Builds a Companion HTTP URL without discarding an Android loopback capability prefix. */
export function companionHttpUrl(endpoint: string, path: string): string {
  if (!path.startsWith("/")) throw new Error("Companion HTTP path must be absolute");
  const url = new URL(endpoint);
  if (url.protocol === "wss:") url.protocol = "https:";
  if (url.protocol === "ws:") url.protocol = "http:";
  const basePath = url.pathname.replace(/\/+$/u, "");
  url.pathname = `${basePath}${path}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}
