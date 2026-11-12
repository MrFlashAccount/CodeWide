import { PullRequestRoute } from "../../../../../../../src/routeComposition/PullRequestRoute";

/** Canonical pull-request Changes destination. */
export default function V1PullRequestChangesDestination(): React.JSX.Element | null {
  return <PullRequestRoute tab="changes" />;
}
