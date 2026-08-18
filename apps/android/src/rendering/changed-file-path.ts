export const DEFAULT_CHANGED_FILE_PATH_CHARS = 48;

export function changedFileDisplayPath(
  filePath: string,
  cwd: string,
  maxChars = DEFAULT_CHANGED_FILE_PATH_CHARS,
): string {
  const normalizedPath = normalizePath(filePath);
  const normalizedCwd = normalizePath(cwd).replace(/\/$/u, "");
  const relative = normalizedCwd === "" || normalizedCwd === "/"
    ? normalizedPath
    : normalizedPath === normalizedCwd
      ? basename(normalizedPath)
      : pathStartsWith(normalizedPath, `${normalizedCwd}/`)
        ? normalizedPath.slice(normalizedCwd.length + 1)
        : normalizedPath;
  return collapsePathMiddle(relative.replace(/^\.\//u, ""), maxChars);
}

function normalizePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/{2,}/gu, "/");
  return normalized.length > 1 ? normalized.replace(/\/$/u, "") : normalized;
}

function basename(value: string): string {
  const segments = value.split("/").filter(Boolean);
  return segments.at(-1) ?? value;
}

function pathStartsWith(value: string, prefix: string): boolean {
  return /^[A-Za-z]:\//u.test(value)
    ? value.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
    : value.startsWith(prefix);
}

function collapsePathMiddle(value: string, maxChars: number): string {
  if (value.length <= maxChars || maxChars <= 0) return value;
  const leadingSlash = value.startsWith("/") ? "/" : "";
  const segments = value.split("/").filter(Boolean);
  if (segments.length < 3) return value;
  const first = `${leadingSlash}${segments[0]!}`;
  const filename = segments.at(-1)!;
  const separator = "/…/";
  let suffix = filename;
  for (let index = segments.length - 2; index > 0; index -= 1) {
    const candidate = `${segments[index]!}/${suffix}`;
    if (first.length + separator.length + candidate.length > maxChars) break;
    suffix = candidate;
  }
  return `${first}${separator}${suffix}`;
}
