import { WorkspaceListStack } from "../../../src/routeComposition/WorkspaceListStack";

// WHY: Expo Router reads this route-module export before mounting the list navigator.
// oxlint-disable-next-line react-doctor/only-export-components
export const unstable_settings = { initialRouteName: "index" };

/** Retains one catalog header while Expo Stack transitions only the list below it. */
export default function V1ListLayout(): React.JSX.Element {
  return <WorkspaceListStack />;
}
