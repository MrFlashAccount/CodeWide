import { WorkspaceListRoute } from "../../src/routeComposition/WorkspaceListRoute";

/** Presents mobile search inside the native stack while desktop keeps its list pane. */
export default function V1SearchRoute(): React.JSX.Element {
  return <WorkspaceListRoute search />;
}
