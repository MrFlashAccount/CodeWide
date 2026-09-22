import type { SidebarProject } from "./sidebarProjects";

/** Route-owned catalog selection independent of the currently selected conversation. */
export type ProjectSelection = {
  readonly closeSidebarProject: () => void;
  readonly openSidebarProject: (project: SidebarProject) => void;
  readonly sidebarProject: SidebarProject | null;
};
