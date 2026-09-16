import { useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../../../src/components/navigation/RouteUnavailable";
import { ProjectPickerSheet } from "../../../../src/features/projects/ProjectPickerSheet";
import { workspaceFeatures as features } from "../../../../src/features/workspace/createWorkspaceFeatures";
import { connectionIdParam } from "../../../../src/services/threads/threadRouteParams";
import { useWorkspaceRouteResources } from "../../../../src/services/workspace/workspaceRouteResources";

const EMPTY_PROJECTS: never[] = [];

/** Composes one server-qualified project directory browser. */
export default function V1AddProjectRoute(): React.JSX.Element {
  const router = useRouter();
  const { connectionId } = useLocalSearchParams<{ connectionId?: string | string[] }>();
  const parsed = connectionIdParam(connectionId);
  const resources = useWorkspaceRouteResources();
  if (
    parsed.status === "invalid" ||
    !resources.connections.some((connection) => connection.id === parsed.value.value)
  ) {
    return (
      <RouteUnavailable
        message="Choose an available server to add a project."
        onBack={() => {
          router.dismissTo("/v1/projects");
        }}
        title="Server unavailable"
      />
    );
  }
  const id = parsed.value.value;
  return (
    <ProjectPickerSheet
      browseOnly
      busy={false}
      cwd=""
      discoveredProjects={EMPTY_PROJECTS}
      error={null}
      onAddProject={async (path) => resources.project.projectWorkspace.addSidebarProject(id, path)}
      onClose={() => {
        router.dismissTo("/v1/projects");
      }}
      onReadDirectory={async (path) => features.projects.readDirectory(id, path)}
      onReadHomeDirectory={async () => features.projects.readProjectHome(id)}
      // WHY: This render-local callback must return a Promise because the picker action contract is async.
      // oxlint-disable-next-line typescript/promise-function-async
      onSelect={() => {
        router.dismissTo("/v1/projects");
        return Promise.resolve();
      }}
      projects={EMPTY_PROJECTS}
      visible
    />
  );
}
