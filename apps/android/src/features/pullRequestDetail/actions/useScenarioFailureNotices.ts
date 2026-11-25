import { useEffect, useRef } from "react";

import type { PullRequestOverview } from "../../../data/forgePullRequestContract";
import type { ScenarioViews } from "./scenarioRuns";
import { usePullRequestFeedback } from "./usePullRequestFeedback";

const NO_VIEWS: ScenarioViews = new Map();

type Snapshot = {
  readonly overview: PullRequestOverview;
  readonly views: ScenarioViews;
};

function previousViews(previous: Snapshot | null, overview: PullRequestOverview): ScenarioViews {
  return previous?.overview.pullRequest === overview.pullRequest &&
    previous.overview.headRevision === overview.headRevision
    ? previous.views
    : NO_VIEWS;
}

function reportFailures(
  current: Snapshot,
  previous: ScenarioViews,
  report: (title: string, reason: string) => void,
): void {
  for (const action of current.overview.catalog.actions) {
    const view = current.views.get(action.actionId);
    if (view?.kind !== "failed") {
      continue;
    }
    const seen = previous.get(action.actionId);
    if (
      seen?.kind === "failed" &&
      seen.finishedAt === view.finishedAt &&
      seen.reason === view.reason
    ) {
      continue;
    }
    report(`${action.label} failed`, view.reason);
  }
}

/** Delivers failures of PR actions outside the Agent section to the app's notice window. */
export function useScenarioFailureNotices(
  overview: PullRequestOverview,
  views: ScenarioViews,
): void {
  const { error } = usePullRequestFeedback();
  const previous = useRef<Snapshot | null>(null);
  useEffect(() => {
    const current = { overview, views };
    reportFailures(current, previousViews(previous.current, overview), error);
    previous.current = current;
  }, [error, overview, views]);
}
