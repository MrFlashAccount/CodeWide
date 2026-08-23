export function normalizeProjectCwd(value: string): string {
  const cwd = value.trim();
  if (cwd === "") return "";
  const windows = /^[A-Za-z]:[\\/]/u.test(cwd) || cwd.startsWith("\\\\");
  if (windows) {
    const slashes = cwd.replaceAll("/", "\\");
    const prefix = slashes.startsWith("\\\\") ? "\\\\" : "";
    const normalized = prefix + slashes.slice(prefix.length).replace(/\\{2,}/gu, "\\");
    return /^[A-Za-z]:\\$/u.test(normalized) ? normalized : normalized.replace(/\\+$/gu, "");
  }
  const leading = cwd.startsWith("//") && !cwd.startsWith("///") ? "//" : cwd.startsWith("/") ? "/" : "";
  const body = cwd.slice(leading.length).replace(/\/{2,}/gu, "/").replace(/\/+$/gu, "");
  return leading + body;
}

export function projectLabel(cwd: string): string {
  const normalized = cwd.replace(/[\\/]+$/u, "");
  if (normalized === "") return cwd;
  return normalized.split(/[\\/]/u).at(-1) || cwd;
}

export function threadContextLabel(
  serverName: string,
  cwd: string,
  projectName?: string | null,
): string {
  const server = serverName.trim();
  const project = projectName?.trim() || projectLabel(cwd).trim() || "workspace";
  return server === "" ? project : `${server} · ${project}`;
}
