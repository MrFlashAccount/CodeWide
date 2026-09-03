export type MarkdownLinkClassification =
  | { kind: "anchor" }
  | { kind: "external"; url: string }
  | { kind: "loopback"; url: string }
  | { href: string; kind: "remoteFile" }
  | { kind: "rejected" };

const SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/iu;

export function classifyMarkdownLink(rawHref: string): MarkdownLinkClassification {
  const href = rawHref.trim();
  if (href === "" || href.includes("\0")) return { kind: "rejected" };
  if (href.startsWith("#")) return { kind: "anchor" };
  if (isLoopbackHttpUrl(href)) {
    return hasExplicitPort(href) ? { kind: "loopback", url: href } : { kind: "rejected" };
  }
  if (isSafeExternalUrl(href)) return { kind: "external", url: href };
  if (href.startsWith("//") || SCHEME_PATTERN.test(href)) return { kind: "rejected" };
  return { href, kind: "remoteFile" };
}

function hasExplicitPort(value: string): boolean {
  try {
    return new URL(value).port !== "";
  } catch {
    return false;
  }
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

export function isLoopbackHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLocaleLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}
