import type { FsReadDirectoryEntry } from "@codewide/codex-protocol/v0.147.0/v2";

export type RemoteProject = {
  path: string;
  name: string;
  addedAt: number;
  lastUsedAt: number;
  pinned: boolean;
};

export type RemoteDirectoryEntry = FsReadDirectoryEntry;

export type PathCrumb = {
  label: string;
  path: string;
};

export function partitionDiscoveredProjects(
  pinned: readonly RemoteProject[],
  discovered: readonly RemoteProject[],
  recentLimit: number,
): { recent: RemoteProject[]; other: RemoteProject[] } {
  const pinnedPaths = new Set(pinned.map(({ path }) => normalizeDirectoryPath(path)));
  const seen = new Set<string>();
  const unpinned = discovered.filter((project) => {
    const path = normalizeDirectoryPath(project.path);
    if (pinnedPaths.has(path) || seen.has(path)) return false;
    seen.add(path);
    return true;
  });
  return {
    recent: unpinned.slice(0, recentLimit),
    other: unpinned.slice(recentLimit),
  };
}

export function projectIncludesDirectory(project: RemoteProject, path: string): boolean {
  return normalizeDirectoryPath(project.path) === normalizeDirectoryPath(path);
}

export function parseRemoteProjects(value: unknown): RemoteProject[] {
  const source = record(value);
  if (!Array.isArray(source?.data)) throw new Error("Companion returned an invalid project list");
  return source.data.map((item) => parseRemoteProject(item));
}

export function parseAddedRemoteProject(value: unknown): RemoteProject {
  const source = record(value);
  return parseRemoteProject(source?.project);
}

export function parseRemoteDirectory(value: unknown): RemoteDirectoryEntry[] {
  const source = record(value);
  if (!Array.isArray(source?.entries)) throw new Error("Companion returned an invalid directory listing");
  return source.entries.flatMap((item) => {
    const entry = record(item);
    if (
      entry === null
      || typeof entry.fileName !== "string"
      || typeof entry.isDirectory !== "boolean"
      || typeof entry.isFile !== "boolean"
      || entry.fileName === "."
      || entry.fileName === ".."
      || /[\\/]/u.test(entry.fileName)
    ) return [];
    return [{ fileName: entry.fileName, isDirectory: entry.isDirectory, isFile: entry.isFile }];
  });
}

export function pathCrumbs(path: string): PathCrumb[] {
  const normalized = normalizeDirectoryPath(path);
  if (normalized === "") return [];
  if (/^[A-Za-z]:\\/u.test(normalized)) {
    const root = normalized.slice(0, 3);
    const segments = normalized.slice(3).split("\\").filter(Boolean);
    const crumbs: PathCrumb[] = [{ label: root, path: root }];
    let current = root;
    for (const segment of segments) {
      current = joinDirectoryPath(current, segment);
      crumbs.push({ label: segment, path: current });
    }
    return crumbs;
  }
  const root = normalized.startsWith("//") ? "//" : normalized.startsWith("/") ? "/" : "";
  const segments = normalized.slice(root.length).split("/").filter(Boolean);
  const crumbs: PathCrumb[] = root === "" ? [] : [{ label: root, path: root }];
  let current = root;
  for (const segment of segments) {
    current = joinDirectoryPath(current, segment);
    crumbs.push({ label: segment, path: current });
  }
  return crumbs;
}

export function parentDirectoryPath(path: string): string | null {
  const crumbs = pathCrumbs(path);
  return crumbs.length < 2 ? null : crumbs.at(-2)?.path ?? null;
}

export function joinDirectoryPath(parent: string, child: string): string {
  const separator = /^[A-Za-z]:\\/u.test(parent) || parent.includes("\\") ? "\\" : "/";
  if (parent.endsWith(separator)) return `${parent}${child}`;
  return `${parent}${separator}${child}`;
}

export function normalizeDirectoryPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "") return "";
  if (/^[A-Za-z]:[\\/]/u.test(trimmed)) {
    const slashes = trimmed.replaceAll("/", "\\").replace(/\\{2,}/gu, "\\");
    return /^[A-Za-z]:\\$/u.test(slashes) ? slashes : slashes.replace(/\\+$/gu, "");
  }
  const root = trimmed.startsWith("//") && !trimmed.startsWith("///") ? "//" : trimmed.startsWith("/") ? "/" : "";
  const body = trimmed.slice(root.length).replace(/\/{2,}/gu, "/").replace(/\/+$/gu, "");
  return root + body;
}

function parseRemoteProject(value: unknown): RemoteProject {
  const project = record(value);
  if (
    project === null
    || typeof project.path !== "string"
    || typeof project.name !== "string"
    || typeof project.addedAt !== "number"
    || typeof project.lastUsedAt !== "number"
  ) throw new Error("Companion returned an invalid project");
  return {
    path: normalizeDirectoryPath(project.path),
    name: project.name,
    addedAt: project.addedAt,
    lastUsedAt: project.lastUsedAt,
    pinned: project.pinned !== false,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
