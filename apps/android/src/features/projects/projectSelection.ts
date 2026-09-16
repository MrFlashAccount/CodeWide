import { useState } from "react";
import { useEvent } from "../../react/useEvent";
import type { SidebarProject } from "./sidebarProjects";

/** Keeps only the sidebar's project filter; route history owns project destinations. */
export function useProjectSelection(
  setMobileThreadQuery: (query: string) => void,
  resetProjectListMode: () => void,
) {
  const [sidebarProject, setSidebarProject] = useState<SidebarProject | null>(null);

  const openSidebarProject = useEvent((project: SidebarProject) => {
    setSidebarProject(project);
    resetProjectListMode();
    setMobileThreadQuery("");
  });

  const closeSidebarProject = useEvent(() => {
    setSidebarProject(null);
    setMobileThreadQuery("");
  });
  return {
    sidebarProject,
    openSidebarProject,
    closeSidebarProject,
  };
}
