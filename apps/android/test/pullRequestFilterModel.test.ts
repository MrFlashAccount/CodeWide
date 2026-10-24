import { afterEach, describe, expect, it } from "vitest";
import {
  activePullRequestFilterCount,
  applyPullRequestFilters,
  defaultPullRequestFilter,
  dismissPullRequestFilters,
  openPullRequestFilters,
  pullRequestFilterSheetModel,
  pullRequestListModel,
  selectPullRequestCategory,
  updatePullRequestFilterDraft,
} from "../src/features/pullRequests/pullRequestListModel";

const ACTIVE_FILTER_COUNT = 2;

afterEach(() => {
  pullRequestListModel.set(defaultPullRequestFilter());
  dismissPullRequestFilters();
});

describe("pull-request filter draft", () => {
  it("keeps cached filter snapshots stable while quick views switch forward and back", () => {
    const reviewRequested = pullRequestListModel.peek();

    selectPullRequestCategory("authored");
    const authored = pullRequestListModel.peek();

    expect(authored).not.toBe(reviewRequested);
    expect(reviewRequested.query.category).toBe("reviewRequested");
    expect(authored.query.category).toBe("authored");

    selectPullRequestCategory("reviewRequested");
    const selectedAgain = pullRequestListModel.peek();

    expect(selectedAgain).not.toBe(authored);
    expect(authored.query.category).toBe("authored");
    expect(selectedAgain.query.category).toBe("reviewRequested");
  });

  it("publishes all draft conditions atomically on Apply", () => {
    openPullRequestFilters();
    updatePullRequestFilterDraft((current) => ({
      ...current,
      query: {
        ...current.query,
        checks: { exclude: [], include: ["failing"] },
        labels: { exclude: [], include: ["release"] },
      },
    }));

    expect(activePullRequestFilterCount(pullRequestListModel.peek())).toBe(0);

    applyPullRequestFilters();

    expect(pullRequestListModel.peek().query.checks.include).toStrictEqual(["failing"]);
    expect(pullRequestListModel.peek().query.labels.include).toStrictEqual(["release"]);
    expect(activePullRequestFilterCount(pullRequestListModel.peek())).toBe(ACTIVE_FILTER_COUNT);
    expect(pullRequestFilterSheetModel.peek().status).toBe("closed");
  });

  it("discards edits when the tray closes without Apply", () => {
    openPullRequestFilters();
    updatePullRequestFilterDraft((current) => ({
      ...current,
      query: { ...current.query, states: { exclude: [], include: ["merged"] } },
    }));

    dismissPullRequestFilters();

    expect(pullRequestListModel.peek()).toStrictEqual(defaultPullRequestFilter());

    openPullRequestFilters();
    const reopened = pullRequestFilterSheetModel.peek();
    expect(reopened.status).toBe("open");
    if (reopened.status === "open") {
      expect(reopened.draft).toStrictEqual(defaultPullRequestFilter());
    }
  });
});
