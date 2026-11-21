import { PullRequestRoute } from "../../../../../../../src/routeComposition/PullRequestRoute";

/** Canonical pull-request Details destination. */
export default function V1PullRequestDetailsDestination(): React.JSX.Element | null {
  return <PullRequestRoute tab="overview" />;
}
