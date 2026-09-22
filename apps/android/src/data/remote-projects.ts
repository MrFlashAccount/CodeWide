import { unknownRecord } from "./unknownRecord";
import type { FsReadDirectoryEntry } from "@codewide/codex-protocol/v0.155.1/v2";

export type RemoteProject = {
  addedAt: number;
  lastUsedAt: number;
  name: string;
  path: string;
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
): { other: RemoteProject[]; recent: RemoteProject[] } {
  const pinnedPaths = new Set(pinned.map(({ path }) => normalizeDirectoryPath(path)));
  const seen = new Set<string>();
  const unpinned = discovered.filter((project) => {
    const path = normalizeDirectoryPath(project.path);
    if (pinnedPaths.has(path) || seen.has(path)) {
      return false;
    }
    seen.add(path);
    return true;
  });
  return {
    other: unpinned.slice(recentLimit),
    recent: unpinned.slice(0, recentLimit),
  };
}

export function projectIncludesDirectory(project: RemoteProject, path: string): boolean {
  return normalizeDirectoryPath(project.path) === normalizeDirectoryPath(path);
}

export function parseRemoteProjects(value: unknown): RemoteProject[] {
  const source = record(value);
  if (!Array.isArray(source?.data)) {
    throw new Error("Companion returned an invalid project list");
  }
  return source.data.map((item) => parseRemoteProject(item));
}

export function parseAddedRemoteProject(value: unknown): RemoteProject {
  const source = record(value);
  return parseRemoteProject(source?.project);
}

/** The server resolves Home; history paths and the phone's user directory are not substitutes. */
export function parseProjectHome(value: unknown): string {
  const path = record(value)?.path;
  if (typeof path !== "string" || path.includes("\0") || !/^(?:\/|[A-Za-z]:[\\/])/u.test(path)) {
    throw new Error("Companion returned an invalid home directory");
  }
  return normalizeDirectoryPath(path);
}

/** Collapse the server-owned home prefix without guessing usernames from path segments. */
export function directoryCrumbs(path: string, home: string | null): PathCrumb[] {
  const crumbs = pathCrumbs(path);
  const homeIndex = home === null ? -1 : crumbs.findIndex((crumb) => crumb.path === home);
  return homeIndex < 0
    ? crumbs
    : [{ label: "Home", path: home ?? "" }, ...crumbs.slice(homeIndex + 1)];
}

export function parseRemoteDirectory(value: unknown): RemoteDirectoryEntry[] {
  const source = record(value);
  if (!Array.isArray(source?.entries)) {
    throw new Error("Companion returned an invalid directory listing");
  }
  return source.entries.flatMap((item) => {
    const entry = record(item);
    if (
      entry === null ||
      typeof entry.fileName !== "string" ||
      typeof entry.isDirectory !== "boolean" ||
      typeof entry.isFile !== "boolean" ||
      entry.fileName === "." ||
      entry.fileName === ".." ||
      /[\\/]/u.test(entry.fileName)
    ) {
      return [];
    }
    return [{ fileName: entry.fileName, isDirectory: entry.isDirectory, isFile: entry.isFile }];
  });
}

export function pathCrumbs(path: string): PathCrumb[] {
  const normalized = normalizeDirectoryPath(path);
  if (normalized === "") {
    return [];
  }
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
  return crumbs.length < 2 ? null : (crumbs.at(-2)?.path ?? null);
}

export function joinDirectoryPath(parent: string, child: string): string {
  const separator = /^[A-Za-z]:\\/u.test(parent) || parent.includes("\\") ? "\\" : "/";
  if (parent.endsWith(separator)) {
    return `${parent}${child}`;
  }
  return `${parent}${separator}${child}`;
}

export function normalizeDirectoryPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "") {
    return "";
  }
  if (/^[A-Za-z]:[\\/]/u.test(trimmed)) {
    const slashes = trimmed.replaceAll("/", "\\").replaceAll(/\\{2,}/gu, "\\");
    return /^[A-Za-z]:\\$/u.test(slashes) ? slashes : slashes.replaceAll(/\\+$/gu, "");
  }
  const root =
    trimmed.startsWith("//") && !trimmed.startsWith("///")
      ? "//"
      : trimmed.startsWith("/")
        ? "/"
        : "";
  const body = trimmed
    .slice(root.length)
    .replaceAll(/\/{2,}/gu, "/")
    .replaceAll(/\/+$/gu, "");
  return root + body;
}

function parseRemoteProject(value: unknown): RemoteProject {
  const project = record(value);
  if (
    project === null ||
    typeof project.path !== "string" ||
    typeof project.name !== "string" ||
    typeof project.addedAt !== "number" ||
    typeof project.lastUsedAt !== "number"
  ) {
    throw new Error("Companion returned an invalid project");
  }
  return {
    addedAt: project.addedAt,
    lastUsedAt: project.lastUsedAt,
    name: project.name,
    path: normalizeDirectoryPath(project.path),
    pinned: project.pinned !== false,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return unknownRecord(value);
}
