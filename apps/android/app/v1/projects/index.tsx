import { useRouter } from "expo-router";

import { SidebarProjectsSheet } from "../../../src/features/projects/SidebarProjects";
import { useWorkspaceRouteResources } from "../../../src/services/workspace/workspaceRouteResources";

/** Composes project management while each directory browser has its own route. */
export default function V1ProjectsRoute(): React.JSX.Element {
  const router = useRouter();
  const { project } = useWorkspaceRouteResources();
  return (
    <SidebarProjectsSheet
      errors={project.projectWorkspace.sidebarProjectErrors}
      // WHY: This callback stays render-local; repository policy delegates ordinary JSX callback memoization to React Compiler.
      // oxlint-disable-next-line react-doctor/jsx-no-new-function-as-prop
      onBrowse={(connectionId) => {
        router.push({ params: { connectionId }, pathname: "/v1/projects/add/[connectionId]" });
      }}
      // WHY: This callback stays render-local; repository policy delegates ordinary JSX callback memoization to React Compiler.
      // oxlint-disable-next-line react-doctor/jsx-no-new-function-as-prop
      onClose={() => {
        router.dismissTo("/v1");
      }}
      onMove={project.projectWorkspace.moveSidebarProject}
      onToggle={project.projectWorkspace.toggleSidebarProject}
      projects={project.projectWorkspace.availableSidebarProjects}
      servers={project.projectWorkspace.sidebarServers}
    />
  );
}
