import type { StoredThreadSummary } from "./thread-summary-types";

export type ThreadProject = {
  cwd: string;
  /** Every historical cwd represented by this logical project. */
  cwds: readonly string[];
  label: string;
  lastUsedAt: number;
};

type MutableThreadProject = {
  cwd: string;
  cwds: Set<string>;
  label: string;
  lastUsedAt: number;
  primaryIsTemporary: boolean;
  primaryLastUsedAt: number;
};

/**
 * Existing Codex projects are logical workspaces seen on a server. A raw cwd is
 * not a project identity: Codex worktrees intentionally give the same project
 * many physical paths.
 */
export function deriveThreadProjects(
  summaries: readonly StoredThreadSummary[],
  connectionId: string,
): ThreadProject[] {
  const projects = new Map<string, MutableThreadProject>();
  for (const summary of summaries) {
    if (summary.connectionId !== connectionId) continue;
    const cwd = normalizeProjectCwd(summary.cwd);
    if (cwd === "") continue;
    const lastUsedAt = summary.recencyAt ?? summary.updatedAt;
    const identity = projectIdentity(cwd, summary.gitOriginUrl);
    const current = projects.get(identity);
    const temporary = isTemporaryWorktree(cwd);
    if (current === undefined) {
      projects.set(identity, {
        cwd,
        cwds: new Set([cwd]),
        label: projectLabel(cwd),
        lastUsedAt,
        primaryIsTemporary: temporary,
        primaryLastUsedAt: lastUsedAt,
      });
      continue;
    }
    current.cwds.add(cwd);
    current.lastUsedAt = Math.max(current.lastUsedAt, lastUsedAt);
    // Starting a new thread in a durable checkout is safer than targeting a
    // disposable worktree that may already have been removed. Among paths of
    // the same class, use the most recently active one.
    if ((current.primaryIsTemporary && !temporary)
      || (current.primaryIsTemporary === temporary && lastUsedAt >= current.primaryLastUsedAt)) {
      current.cwd = cwd;
      current.primaryIsTemporary = temporary;
      current.primaryLastUsedAt = lastUsedAt;
    }
  }

  const result = [...projects.values()].map<ThreadProject>((project) => ({
    cwd: project.cwd,
    cwds: [...project.cwds],
    label: project.label,
    lastUsedAt: project.lastUsedAt,
  }));
  disambiguateLabels(result);
  return result.sort((left, right) =>
    right.lastUsedAt - left.lastUsedAt || left.label.localeCompare(right.label),
  );
}

export function projectIncludesCwd(project: ThreadProject, cwd: string): boolean {
  const normalized = normalizeProjectCwd(cwd);
  return project.cwds.includes(normalized);
}

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

function projectIdentity(cwd: string, gitOriginUrl?: string | null): string {
  const origin = normalizeGitOrigin(gitOriginUrl);
  if (origin !== null) return `git:${origin}:${projectLabel(cwd)}`;
  return `cwd:${cwd}`;
}

function normalizeGitOrigin(value?: string | null): string | null {
  const origin = value?.trim().replace(/[\\/]+$/u, "").replace(/\.git$/iu, "");
  return origin === undefined || origin === "" ? null : origin.toLocaleLowerCase();
}

function isTemporaryWorktree(cwd: string): boolean {
  return /\/\.codex\/worktrees\/[^/]+(?:\/|$)/u.test(cwd);
}

function disambiguateLabels(projects: ThreadProject[]): void {
  const groups = new Map<string, ThreadProject[]>();
  for (const project of projects) {
    const group = groups.get(project.label) ?? [];
    group.push(project);
    groups.set(project.label, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const baseLabel = group[0]?.label ?? "project";
    for (const project of group) {
      project.label = `${baseLabel} · ${uniqueParentSegment(project.cwd, group)}`;
    }
  }
}

function uniqueParentSegment(cwd: string, group: readonly ThreadProject[]): string {
  const parents = parentSegments(cwd);
  const otherParents = group.filter((candidate) => candidate.cwd !== cwd).map((candidate) => parentSegments(candidate.cwd));
  for (let distance = 0; distance < parents.length; distance += 1) {
    const segment = parents[distance];
    if (segment !== undefined && otherParents.every((candidate) => candidate[distance] !== segment)) return segment;
  }
  return cwd;
}

function parentSegments(cwd: string): string[] {
  const segments = cwd.split(/[\\/]/u).filter(Boolean);
  return segments.slice(0, -1).reverse();
}
