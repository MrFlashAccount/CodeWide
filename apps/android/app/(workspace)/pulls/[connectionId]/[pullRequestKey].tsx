import { PullRequestRoute } from "../../../../src/routeComposition/PullRequestRoute";

/** Pull request destination; its own Suspense skeleton covers overview loading. */
export default function V1PullRequestDestination(): React.JSX.Element | null {
  return <PullRequestRoute />;
}
