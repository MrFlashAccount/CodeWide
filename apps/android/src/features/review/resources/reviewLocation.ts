import type { CodeReviewLineReference } from "../comments/reviewComment";

export function shortPath(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  const short = parts.slice(-2).join("/");
  return short === "" ? path : short;
}

export function reviewTreePath(path: string, cwd: string): string {
  const normalizedPath = path.replaceAll("\\", "/");
  const normalizedCwd = cwd.replaceAll("\\", "/").replace(/\/$/, "");
  return normalizedCwd !== "" && normalizedPath.startsWith(`${normalizedCwd}/`)
    ? normalizedPath.slice(normalizedCwd.length + 1)
    : normalizedPath.replace(/^\//, "");
}

export function sameLineReference(
  left: CodeReviewLineReference,
  right: CodeReviewLineReference,
): boolean {
  return (
    left.path === right.path &&
    left.line === right.line &&
    left.side === right.side &&
    (left.coordinate ?? "file") === (right.coordinate ?? "file")
  );
}
