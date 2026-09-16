import { projectScopeKey } from "../../data/project-unread-model";
import type { RemoteProject } from "../../data/remote-projects";

/** A project shortcut retains its owner even in the aggregate server list. */
export type SidebarProject = {
  connectionId: string;
  key: string;
  lastUsedAt: number;
  name: string;
  path: string;
  pinned: boolean;
  /** Visible only when another pinned shortcut has the same display name. */
  serverLabel: string | null;
  subtitle: string;
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
      if (!project.pinned) {
        continue;
      }
      const name = project.name.trim().toLowerCase();
      pinnedNames.set(name, (pinnedNames.get(name) ?? 0) + 1);
    }
  }
  for (const server of servers) {
    const projects = (catalogs[server.id] ?? []).slice().sort((a, b) => {
      const addedAtOrder = a.addedAt - b.addedAt;
      return addedAtOrder !== 0 ? addedAtOrder : a.path.localeCompare(b.path);
    });
    for (const project of projects) {
      const key = projectScopeKey(server.id, project.path);
      result.push({
        connectionId: server.id,
        key,
        lastUsedAt: project.lastUsedAt,
        name: project.name,
        path: project.path,
        pinned: project.pinned,
        serverLabel:
          (pinnedNames.get(project.name.trim().toLowerCase()) ?? 0) > 1 ? server.name : null,
        subtitle: servers.length > 1 ? `${server.name} · ${project.path}` : project.path,
        unread: unreadProjects.includes(key),
      });
    }
  }
  return result;
}
