import type { SidebarProject } from "./sidebarProjects";

/** Project, server, and action contract for the project manager. */
export type ProjectManagementProps = {
  projects: readonly SidebarProject[];
  servers: readonly { id: string; name: string }[];
  errors: readonly string[];
  onToggle(project: SidebarProject): Promise<void>;
  onMove(project: SidebarProject, direction: -1 | 1): Promise<void>;
  onBrowse(connectionId: string): void;
  onClose(): void;
};
/** Collapsible project group owned by one project-manager section. */
export type ProjectManagerSection = {
  title: string;
  projects: readonly SidebarProject[];
  expanded: boolean;
  onToggle: (() => void) | undefined;
};
/** Renderable row in the flattened project-management list. */
export type ProjectManagerItem =
  | { kind: "section"; key: string; section: ProjectManagerSection }
  | { kind: "project"; key: string; project: SidebarProject }
  | { kind: "server"; key: string; server: { id: string; name: string } }
  | { kind: "message"; key: string; message: string; error: boolean };
