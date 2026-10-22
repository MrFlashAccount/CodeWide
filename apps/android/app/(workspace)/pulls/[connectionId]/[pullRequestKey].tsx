import { PullRequestRoute } from "../../../../src/routeComposition/PullRequestRoute";

/** Pull request destination, revealed after its overview is ready. */
export default function V1PullRequestDestination(): React.JSX.Element | null {
  return <PullRequestRoute />;
}
