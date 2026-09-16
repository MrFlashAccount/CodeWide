const DEFAULT_CHANGED_FILE_PATH_CHARS = 48;

export function changedFileDisplayPath(
  filePath: string,
  cwd: string,
  maxChars = DEFAULT_CHANGED_FILE_PATH_CHARS,
): string {
  const normalizedPath = normalizePath(filePath);
  const normalizedCwd = normalizePath(cwd).replace(/\/$/u, "");
  const relative =
    normalizedCwd === "" || normalizedCwd === "/"
      ? normalizedPath
      : normalizedPath === normalizedCwd
        ? changedPathBasename(normalizedPath)
        : pathStartsWith(normalizedPath, `${normalizedCwd}/`)
          ? normalizedPath.slice(normalizedCwd.length + 1)
          : normalizedPath;
  return collapsePathMiddle(relative.replace(/^\.\//u, ""), maxChars);
}

function normalizePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replaceAll(/\/{2,}/gu, "/");
  return normalized.length > 1 ? normalized.replace(/\/$/u, "") : normalized;
}

function changedPathBasename(value: string): string {
  const segments = value.split("/").filter(Boolean);
  return segments.at(-1) ?? value;
}

function pathStartsWith(value: string, prefix: string): boolean {
  return /^[A-Za-z]:\//u.test(value)
    ? value.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
    : value.startsWith(prefix);
}

function collapsePathMiddle(value: string, maxChars: number): string {
  if (value.length <= maxChars || maxChars <= 0) {
    return value;
  }
  const leadingSlash = value.startsWith("/") ? "/" : "";
  const segments = value.split("/").filter(Boolean);
  if (segments.length < 3) {
    return value;
  }
  const firstSegment = segments[0];
  const filename = segments.at(-1);
  if (firstSegment === undefined || filename === undefined) {
    return value;
  }
  const first = `${leadingSlash}${firstSegment}`;
  const separator = "/…/";
  const suffix = collapsedPathSuffix(
    segments,
    filename,
    maxChars - first.length - separator.length,
  );
  return `${first}${separator}${suffix}`;
}

function collapsedPathSuffix(
  segments: readonly string[],
  filename: string,
  maxSuffixChars: number,
): string {
  let suffix = filename;
  for (let index = segments.length - 2; index > 0; index -= 1) {
    const segment = segments[index];
    if (segment === undefined) {
      continue;
    }
    const candidate = `${segment}/${suffix}`;
    if (candidate.length > maxSuffixChars) {
      break;
    }
    suffix = candidate;
  }
  return suffix;
}

/** V1 changed-file-path owner, extracted without changing interaction or resource lifetime. */

export function basename(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/u, "");
  return normalized.split("/").filter(Boolean).at(-1) ?? "attachment";
}
