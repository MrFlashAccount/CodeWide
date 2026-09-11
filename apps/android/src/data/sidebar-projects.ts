import type { RemoteProject } from "./remote-projects";
import { projectScopeKey } from "./project-unread-model";

/** A project shortcut retains its owner even in the aggregate server list. */
export type SidebarProject = {
  key: string;
  connectionId: string;
  path: string;
  name: string;
  /** Visible only when another pinned shortcut has the same display name. */
  serverLabel: string | null;
  subtitle: string;
  pinned: boolean;
  lastUsedAt: number;
  unread: boolean;
};

/** Pinned order is independent of incoming thread activity. */
export function sidebarProjects(
  catalogs: Readonly<Record<string, readonly RemoteProject[]>>,
  servers: readonly { id: string; name: string }[],
  unreadProjects: readonly string[],
): SidebarProject[] {
  const result: SidebarProject[] = [];
  const pinnedNames = new Map<string, number>();
  for (const server of servers) {
    for (const project of catalogs[server.id] ?? []) {
      if (!project.pinned) continue;
      const name = project.name.trim().toLowerCase();
      pinnedNames.set(name, (pinnedNames.get(name) ?? 0) + 1);
    }
  }
  for (const server of servers) {
    const projects = (catalogs[server.id] ?? [])
      .slice()
      .sort((a, b) => a.addedAt - b.addedAt || a.path.localeCompare(b.path));
    for (const project of projects) {
      const key = projectScopeKey(server.id, project.path);
      result.push({
        key,
        connectionId: server.id,
        path: project.path,
        name: project.name,
        serverLabel:
          (pinnedNames.get(project.name.trim().toLowerCase()) ?? 0) > 1 ? server.name : null,
        subtitle: servers.length > 1 ? `${server.name} · ${project.path}` : project.path,
        pinned: project.pinned,
        lastUsedAt: project.lastUsedAt,
        unread: unreadProjects.includes(key),
      });
    }
  }
  return result;
}
