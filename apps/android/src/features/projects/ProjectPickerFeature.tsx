import type { RemoteDirectoryEntry, RemoteProject } from "../../data/remote-projects";
import type { ThreadListServer } from "../connections/connectionPresentation";
import type { SidebarProject } from "./sidebarProjects";
import { SidebarProjectsSheet } from "./SidebarProjects";
import { ProjectPickerSheet } from "./ProjectPickerSheet";

type ProjectPickerFeatureProps = {
  projectsSheetVisible: boolean;
  projectDirectoryServerId: string | null;
  availableSidebarProjects: readonly SidebarProject[];
  sidebarServers: readonly ThreadListServer[];
  sidebarProjectErrors: readonly string[];
  toggleSidebarProject(project: SidebarProject): Promise<void>;
  moveSidebarProject(project: SidebarProject, direction: -1 | 1): Promise<void>;
  setProjectDirectoryServerId(id: string | null): void;
  setProjectsSheetVisible(visible: boolean): void;
  addSidebarProject(connectionId: string, path: string): Promise<RemoteProject>;
  readDirectory(connectionId: string, path: string): Promise<RemoteDirectoryEntry[]>;
  readProjectHome(connectionId: string): Promise<string>;
};

/** Project management and browsing share one mounted selection owner. */
export function ProjectPickerFeature({
  projectsSheetVisible,
  projectDirectoryServerId,
  availableSidebarProjects,
  sidebarServers,
  sidebarProjectErrors,
  toggleSidebarProject,
  moveSidebarProject,
  setProjectDirectoryServerId,
  setProjectsSheetVisible,
  addSidebarProject,
  readDirectory,
  readProjectHome,
}: ProjectPickerFeatureProps) {
  return !projectsSheetVisible ? null : projectDirectoryServerId === null ? (
    <SidebarProjectsSheet
      projects={availableSidebarProjects}
      servers={sidebarServers}
      errors={sidebarProjectErrors}
      onToggle={toggleSidebarProject}
      onMove={moveSidebarProject}
      onBrowse={setProjectDirectoryServerId}
      onClose={() => setProjectsSheetVisible(false)}
    />
  ) : (
    <ProjectPickerSheet
      key={projectDirectoryServerId}
      visible
      browseOnly
      cwd=""
      projects={[]}
      discoveredProjects={[]}
      busy={false}
      error={null}
      onReadDirectory={(path) => readDirectory(projectDirectoryServerId, path)}
      onReadHomeDirectory={() => readProjectHome(projectDirectoryServerId)}
      onAddProject={(path) => addSidebarProject(projectDirectoryServerId, path)}
      onSelect={async () => {
        setProjectDirectoryServerId(null);
      }}
      onClose={() => setProjectDirectoryServerId(null)}
    />
  );
}
