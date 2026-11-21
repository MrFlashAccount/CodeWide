import { ThreadsWorkspaceRouteLayout } from "../../../../src/routeComposition/ThreadsWorkspaceRouteLayout";

// WHY: Expo Router reads this required route-module export before rendering the layout component.
// oxlint-disable-next-line react-doctor/only-export-components
export const unstable_settings = { anchor: "(lists)", initialRouteName: "(lists)" };

/** Owns the Router history and anchored catalog for the Threads subtree. */
export default function V1ThreadsLayout(): React.JSX.Element {
  return <ThreadsWorkspaceRouteLayout />;
}
