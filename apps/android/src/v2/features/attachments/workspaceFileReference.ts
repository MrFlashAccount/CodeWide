/** Parses a Markdown-local href into one normalized path relative to the
 * authoritative thread workspace. Absolute paths and traversal are rejected. */
export function workspaceFileReference(href: string): string | null {
  const withoutFragment = href.trim().split("#", 1)[0] ?? "";
  if (withoutFragment === "" || withoutFragment.includes("\0")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    return null;
  }
  if (
    decoded.includes("\0") ||
    decoded.startsWith("/") ||
    decoded.startsWith("\\") ||
    decoded.startsWith("//") ||
    /^[A-Za-z][A-Za-z\d+.-]*:/u.test(decoded)
  ) {
    return null;
  }
  const segments: string[] = [];
  for (const segment of decoded.replaceAll("\\", "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.pop() === undefined) return null;
      continue;
    }
    segments.push(segment);
  }
  return segments.length === 0 ? null : segments.join("/");
}
