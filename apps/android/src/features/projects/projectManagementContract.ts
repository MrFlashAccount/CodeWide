import type { SidebarProject } from "./sidebarProjects";
export type ProjectManagementProps = {
  projects: readonly SidebarProject[];
  servers: readonly { id: string; name: string }[];
  errors: readonly string[];
  onToggle(project: SidebarProject): Promise<void>;
  onMove(project: SidebarProject, direction: -1 | 1): Promise<void>;
  onBrowse(connectionId: string): void;
  onClose(): void;
};
export type ProjectManagerSection = {
  title: string;
  projects: readonly SidebarProject[];
  expanded: boolean;
  onToggle: (() => void) | undefined;
};
export type ProjectManagerItem =
  | { kind: "section"; key: string; section: ProjectManagerSection }
  | { kind: "project"; key: string; project: SidebarProject }
  | { kind: "server"; key: string; server: { id: string; name: string } }
  | { kind: "message"; key: string; message: string; error: boolean };
