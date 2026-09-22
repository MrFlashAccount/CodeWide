import { WorkspaceRouteThreadList } from "./WorkspaceRouteThreadList";
import {
  useWorkspaceListRouteResources,
  WorkspaceListRouteContext,
} from "./workspaceListRouteResources";
import { WorkspaceShell } from "./WorkspaceShell";
import type { WorkspaceRouteResources } from "../services/workspace/workspaceRouteResources";

/** Mobile All and Search live inside the native stack; desktop retains its sidebar. */
export function WorkspaceListRoute({
  search = false,
}: {
  readonly search?: boolean;
}): React.JSX.Element | null {
  const resources = useWorkspaceListRouteResources();
  return search && resources.desktop ? null : (
    <WorkspaceRouteThreadList
      {...resources}
      sidebarSearch={search ? resources.sidebarSearch : null}
    />
  );
}

/** Places desktop catalog chrome and mobile route capabilities under one resource boundary. */
export function WorkspaceListRouteShell({
  listProps,
  resources,
}: {
  readonly listProps: ReturnType<typeof useWorkspaceListRouteResources>;
  readonly resources: WorkspaceRouteResources;
}): React.JSX.Element {
  return (
    <WorkspaceListRouteContext.Provider value={listProps}>
      <WorkspaceShell resources={resources} />
    </WorkspaceListRouteContext.Provider>
  );
}
