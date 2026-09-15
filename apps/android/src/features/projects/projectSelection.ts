import { useState } from "react";
import { useEvent } from "../../react/useEvent";
import type { SidebarProject } from "./sidebarProjects";

/** Project selection and directory-sheet state live for the mounted workspace. */
export function useProjectSelection(
  setMobileThreadQuery: (query: string) => void,
  resetProjectListMode: () => void,
) {
  const [sidebarProject, setSidebarProject] = useState<SidebarProject | null>(null);

  const [projectsSheetVisible, setProjectsSheetVisible] = useState(false);

  const [projectDirectoryServerId, setProjectDirectoryServerId] = useState<string | null>(null);

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
    projectsSheetVisible,
    setProjectsSheetVisible,
    projectDirectoryServerId,
    setProjectDirectoryServerId,
    openSidebarProject,
    closeSidebarProject,
  };
}
