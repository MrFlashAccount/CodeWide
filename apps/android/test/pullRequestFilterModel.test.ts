import { afterEach, describe, expect, it } from "vitest";
import {
  activePullRequestFilterCount,
  applyPullRequestFilters,
  defaultPullRequestFilter,
  dismissPullRequestFilters,
  openPullRequestFilters,
  pullRequestFilterSheetModel,
  pullRequestListModel,
  resetPullRequestFilterDraft,
  selectPullRequestSearchText,
  selectPullRequestSort,
  updatePullRequestFilterDraft,
} from "../src/features/pullRequests/pullRequestListModel";

const ACTIVE_FILTER_COUNT = 2;

afterEach(() => {
  pullRequestListModel.set(defaultPullRequestFilter());
  dismissPullRequestFilters();
});

describe("pull-request filter draft", () => {
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

  it("resets only structured filters and preserves view, search and sort", () => {
    selectPullRequestSearchText("is:team");
    selectPullRequestSort({ direction: "ascending", field: "created" });
    openPullRequestFilters();
    updatePullRequestFilterDraft((current) => ({
      ...current,
      query: { ...current.query, checks: { exclude: [], include: ["failing"] } },
    }));

    resetPullRequestFilterDraft();

    const state = pullRequestFilterSheetModel.peek();
    expect(state.status).toBe("open");
    if (state.status === "open") {
      expect(activePullRequestFilterCount(state.draft)).toBe(0);
      expect(state.draft.query.category).toBe("involved");
      expect(state.draft.query.text).toBe("is:team");
      expect(state.draft.query.sort).toStrictEqual({ direction: "ascending", field: "created" });
    }
  });
});
