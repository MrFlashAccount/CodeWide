import { PullRequestsWorkspaceRouteLayout } from "../../../../src/routeComposition/PullRequestsWorkspaceRouteLayout";

// WHY: Expo Router reads this required route-module export before rendering the layout component.
// oxlint-disable-next-line react-doctor/only-export-components
export const unstable_settings = { anchor: "pulls/index", initialRouteName: "pulls/index" };

/** Owns the Router history and anchored catalog for the Pull requests subtree. */
export default function V1PullRequestsLayout(): React.JSX.Element {
  return <PullRequestsWorkspaceRouteLayout />;
}
