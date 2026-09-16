export function normalizeProjectCwd(value: string): string {
  const cwd = value.trim();
  if (cwd === "") {
    return "";
  }
  const windows = /^[A-Za-z]:[\\/]/u.test(cwd) || cwd.startsWith(String.raw`\\`);
  if (windows) {
    const slashes = cwd.replaceAll("/", "\\");
    const prefix = slashes.startsWith(String.raw`\\`) ? String.raw`\\` : "";
    const normalized = prefix + slashes.slice(prefix.length).replaceAll(/\\{2,}/gu, "\\");
    return /^[A-Za-z]:\\$/u.test(normalized) ? normalized : normalized.replaceAll(/\\+$/gu, "");
  }
  const leading =
    cwd.startsWith("//") && !cwd.startsWith("///") ? "//" : cwd.startsWith("/") ? "/" : "";
  const body = cwd
    .slice(leading.length)
    .replaceAll(/\/{2,}/gu, "/")
    .replaceAll(/\/+$/gu, "");
  return leading + body;
}

export function projectLabel(cwd: string): string {
  const normalized = cwd.replace(/[\\/]+$/u, "");
  if (normalized === "") {
    return cwd;
  }
  const segment = normalized.split(/[\\/]/u).at(-1);
  return segment === undefined || segment === "" ? cwd : segment;
}

export function threadContextLabel(
  serverName: string,
  cwd: string,
  projectName?: string | null,
): string {
  const server = serverName.trim();
  const explicitProject = projectName?.trim();
  const cwdProject = projectLabel(cwd).trim();
  const project =
    explicitProject !== undefined && explicitProject !== ""
      ? explicitProject
      : cwdProject === ""
        ? "workspace"
        : cwdProject;
  return server === "" ? project : `${server} · ${project}`;
}
