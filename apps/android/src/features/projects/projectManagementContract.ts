import type { SidebarProject } from "./sidebarProjects";

/** Project, server, and action contract for the project manager. */
export type ProjectManagementProps = {
  errors: readonly string[];
  onBrowse: (connectionId: string) => void;
  onClose: () => void;
  onMove: (project: SidebarProject, direction: -1 | 1) => Promise<void>;
  onToggle: (project: SidebarProject) => Promise<void>;
  projects: readonly SidebarProject[];
  servers: readonly { id: string; name: string }[];
};
/** Collapsible project group owned by one project-manager section. */
export type ProjectManagerSection = {
  expanded: boolean;
  onToggle: (() => void) | undefined;
  projects: readonly SidebarProject[];
  title: string;
};
/** Renderable row in the flattened project-management list. */
export type ProjectManagerItem =
  | { key: string; kind: "section"; section: ProjectManagerSection }
  | { key: string; kind: "project"; project: SidebarProject }
  | { key: string; kind: "server"; server: { id: string; name: string } }
  | { error: boolean; key: string; kind: "message"; message: string };
