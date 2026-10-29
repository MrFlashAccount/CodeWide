import { WorkspaceTabsRouteLayout } from "../../../src/routeComposition/WorkspaceTabsRouteLayout";

// WHY: Expo Router reads this required route-module export before rendering the layout component.
// oxlint-disable-next-line react-doctor/only-export-components
export const unstable_settings = { initialRouteName: "(threads)" };

/** Owns the retained Threads and Pull requests tab navigator. */
export default function V1WorkspaceTabsLayout(): React.JSX.Element {
  return <WorkspaceTabsRouteLayout />;
}
