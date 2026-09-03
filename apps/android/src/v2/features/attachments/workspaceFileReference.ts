/** Parses a Markdown-local href into a normalized workspace-relative or
 * explicitly absolute host path. The server authorizes absolute reads with
 * the terminal-equivalent scope. */
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
    decoded.startsWith("\\") ||
    decoded.startsWith("//") ||
    /^[A-Za-z][A-Za-z\d+.-]*:/u.test(decoded)
  ) {
    return null;
  }
  const absolute = decoded.startsWith("/");
  const segments: string[] = [];
  for (const segment of decoded.replaceAll("\\", "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.pop() === undefined && !absolute) return null;
      continue;
    }
    segments.push(segment);
  }
  if (segments.length === 0) return null;
  return `${absolute ? "/" : ""}${segments.join("/")}`;
}
