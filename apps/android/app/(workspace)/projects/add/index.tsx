import { useIsFocused, useRouter } from "expo-router";
import { ProjectDirectoryPicker } from "../../../../src/features/projects/ProjectDirectoryPicker";
import { workspaceRuntime } from "../../../../src/data/workspace-runtime";
import { useEvent } from "../../../../src/react/useEvent";
import { workspaceFeatures as features } from "../../../../src/features/workspace/createWorkspaceFeatures";
import { useWorkspaceRouteResources } from "../../../../src/services/workspace/workspaceRouteResources";

/** Starts project addition at the server catalogue without choosing a destination implicitly. */
export default function V1AddProjectServersRoute(): React.JSX.Element {
  const router = useRouter();
  const visible = useIsFocused();
  const resources = useWorkspaceRouteResources();
  const close = useEvent(() => {
    router.dismissTo("/projects");
  });
  return (
    <ProjectDirectoryPicker
      connections={resources.connections}
      initialConnectionId={null}
      native={workspaceRuntime.native}
      onAddProject={resources.project.projectWorkspace.addSidebarProject}
      onClose={close}
      remote={{
        readDirectory: features.projects.readDirectory,
        readProjectHome: features.projects.readProjectHome,
      }}
      servers={resources.list.servers}
      visible={visible}
    />
  );
}
