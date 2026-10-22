import { describe, expect, it, vi } from "vitest";

import { parsePullRequestKeyParam, type PullRequestKey } from "../src/data/forgeContract";
import { parseFilesPage } from "../src/data/forgeMutationContract";
import { parseLinks, parsePullRequestListPage } from "../src/data/forgePullRequestContract";
import type { ForgeSnapshotCache } from "../src/data/forgeSnapshotCache.types";
import { createPullRequestCommentDestinations } from "../src/data/pullRequestCommentDestinations";
import { parseDrafts } from "../src/data/reviewDraftContract";
import { parseGuideState } from "../src/data/reviewGuideContract";
import { settledChecksLabel } from "../src/features/pullRequestDetail/overview/checkPresentation";
import { reviewRequestedCount } from "../src/features/pullRequests/pullRequestListModel";
import { fileRowDetail, hunkAt, viewedLabel } from "../src/features/pullRequestDetail/changes/changesPresentation";
import { dockCounts, submittableDraftIds } from "../src/features/pullRequestDetail/changes/dockCounts";
import { publishedDetail, publishedTitle } from "../src/features/pullRequestDetail/changes/submitResultCopy";
import { defaultScenarioTarget } from "../src/features/pullRequestDetail/actions/scenarioTarget";
import { messageDockTarget } from "../src/features/pullRequestDetail/dock/messageDockTarget";
import { safeProviderUrl } from "../src/data/forgeProviderUrl";
import { defaultDestination, destinationExplanation } from "../src/features/review/comments/destinationPolicy";
import { draftBadges } from "../src/features/review/comments/draftDisplay";
import { resumeIndex, stopNarration, walkStops } from "../src/features/review/guide/guideWalk";
import { draftsSnapshot, filesPage, guideState, prDraft, reviewRequestedPage } from "./fixtures/forgeWireFixtures";

describe("provider URLs", () => {
  it.each([
    ["https://github.com/login/device", "https://github.com/login/device"],
    ["http://github.com/login/device", null],
    ["https://evil.example/login/device", null],
    ["https://user:pass@github.com/login/device", null],
    ["https://github.com:8443/login/device", null],
    ["codewide://pair?token=x", null],
    ["not a url", null],
  ])("opens %s only when https on the provider host", (url, expected) => {
    expect(safeProviderUrl(url, "github.com")).toBe(expected);
  });
});

describe("Changes presentation", () => {
  const page = parseFilesPage(filesPage);
  const [present, tooLarge, notProvided] = page?.files ?? [];

  it("says where each viewed mark lives", () => {
    expect(present === undefined ? null : viewedLabel(present, "github.com")).toBe("Viewed · github.com");
    expect(notProvided === undefined ? null : viewedLabel(notProvided, "github.com")).toBe("Viewed · this companion");
  });

  it("explains files without a patch in place", () => {
    expect(tooLarge === undefined ? null : fileRowDetail(tooLarge, 0, "github.com")).toBe("new file · Too large to render");
    expect(present === undefined ? null : fileRowDetail(present, 2, "github.com")).toBe("2 drafts · viewed on github.com");
  });

  it("finds the hunk under a new-side line for the draft anchor", () => {
    expect(present === undefined ? null : hunkAt(present, 210, "new")?.ordinal).toBe(1);
    expect(present === undefined ? null : hunkAt(present, 400, "new")).toBeNull();
  });
});

describe("review dock and Submit", () => {
  const drafts = parseDrafts(draftsSnapshot)?.drafts ?? [];

  it("counts what Submit publishes, forwards and leaves", () => {
    expect(dockCounts(drafts)).toEqual({ agentOnly: 1, bothPending: 1, toPr: 2, total: 3 });
    expect(submittableDraftIds(drafts)).toEqual(["d1", "d2"]);
  });

  it("shows one badge per active axis", () => {
    const both = drafts.find((draft) => draft.destination === "both");
    expect(both === undefined ? [] : draftBadges(both, "github.com").map((badge) => badge.label)).toEqual(["PR", "Agent"]);
    const published = parseDrafts({
      drafts: [prDraft("p", { destination: "pr", pr: { state: "published" }, sourceKind: "pullRequest" })],
      revision: "3fa9e12",
    })?.drafts[0];
    expect(published === undefined ? [] : draftBadges(published, "github.com").map((badge) => badge.label)).toEqual([
      "Published · github.com",
    ]);
  });
});

describe("comment destination policy", () => {
  it("defaults to PR on others' PRs, Agent on one's own and sessions, and prefers the remembered choice", () => {
    expect(defaultDestination(null, { ownPullRequest: false })).toBe("pr");
    expect(defaultDestination(null, { ownPullRequest: true })).toBe("agent");
    expect(defaultDestination("both", { ownPullRequest: false })).toBe("both");
    expect(defaultDestination(null, null)).toBe("agent");
  });

  it("persists the choice per PR in the connection store and forgets it with the connection", async () => {
    const stores = new Map<string, Map<string, unknown>>();
    const storeOf = (connection: string): Map<string, unknown> => {
      const existing = stores.get(connection) ?? new Map<string, unknown>();
      stores.set(connection, existing);
      return existing;
    };
    const store: ForgeSnapshotCache = {
      deleteConnection: async (connection) => {
        stores.delete(connection);
      },
      read: async (connection, key) => storeOf(connection).get(key) ?? null,
      write: async (connection, key, value) => {
        storeOf(connection).set(key, value);
      },
    };
    const pr = requireKey("fpr1.github-91");
    const other = requireKey("fpr1.github-92");
    createPullRequestCommentDestinations(store).remember("c", pr, "both");
    await Promise.resolve();

    const restarted = createPullRequestCommentDestinations(store);
    restarted.hydrate("c", pr);
    restarted.hydrate("c", other);
    await vi.waitFor(() => {
      expect(restarted.destinations$[restarted.keyOf("c", pr)]?.peek()).toBe("both");
    });
    expect(restarted.destinations$[restarted.keyOf("c", other)]?.peek()).toBeUndefined();

    await store.deleteConnection("c");
    const afterDelete = createPullRequestCommentDestinations(store);
    afterDelete.hydrate("c", pr);
    await Promise.resolve();
    await Promise.resolve();
    expect(afterDelete.destinations$[afterDelete.keyOf("c", pr)]?.peek()).toBeUndefined();
  });

  it("names where each half lands", () => {
    const context = { host: "github.com", ownPullRequest: false, threadTitle: "Forge auth state" };
    expect(destinationExplanation("pr", context)).toContain("only by Submit review");
    expect(destinationExplanation("both", context)).toContain("Forge auth state");
    expect(destinationExplanation("agent", context)).toContain("never reaches github.com");
  });
});

describe("scenario target", () => {
  const links = parseLinks({
    links: [
      { source: "branch", threadId: "thread-forge-auth" },
      { source: "manual", threadId: "thread-review-91" },
    ],
  }) ?? [];
  const [branch, manual] = links;
  const describeThread = (threadId: string): string => `title of ${threadId}`;

  it("uses the single or the one branch-linked thread, asks otherwise, and starts a new one with none", () => {
    expect(defaultScenarioTarget([])).toEqual({ kind: "newThread" });
    expect(manual === undefined ? null : defaultScenarioTarget([manual])).toEqual({ kind: "thread", threadId: manual?.threadId });
    expect(defaultScenarioTarget(links)).toEqual({ kind: "thread", threadId: branch?.threadId });
    expect(manual === undefined ? null : defaultScenarioTarget([manual, { ...manual, threadId: links[0]?.threadId ?? manual.threadId }])).toBeNull();
  });

  it("names the same target in the dock chip that the send uses, and keeps a valid choice", () => {
    const initial = messageDockTarget(links, null, describeThread);
    expect(initial.label).toBe("title of thread-forge-auth");
    expect(initial.target).toEqual({ kind: "thread", threadId: branch?.threadId });
    expect(initial.choices.map((choice) => [choice.label, choice.selected])).toEqual([
      ["title of thread-forge-auth", true],
      ["title of thread-review-91", false],
      ["New thread", false],
    ]);
    const picked = initial.choices[1]?.target ?? null;
    expect(messageDockTarget(links, picked, describeThread).label).toBe("title of thread-review-91");
    // A choice that is no longer linked falls back to the default rule.
    expect(manual === undefined ? null : messageDockTarget([manual], { kind: "thread", threadId: branch?.threadId ?? manual.threadId }, describeThread).label).toBe("title of thread-review-91");
    expect(messageDockTarget([], null, describeThread)).toEqual({ choices: [], label: "New thread", target: { kind: "newThread" } });
  });
});

describe("guide walk", () => {
  it("resumes at the first stop that still needs the reviewer", () => {
    const state = parseGuideState(guideState);
    const stops = state?.guide === null || state === null ? [] : walkStops(state.guide);
    expect(stops.map((stop) => stop.stop.stopId)).toEqual(["s1", "s2"]);
    expect(state === null ? null : resumeIndex(state, stops)).toBe(1);
  });
});

function requireKey(value: string): PullRequestKey {
  const key = parsePullRequestKeyParam(value);
  if (key === null) {
    throw new Error(`Invalid PR key ${value}`);
  }
  return key;
}

describe("counters agree with their headers", () => {
  const passed = { checkId: "c1", detailsUrl: null, durationSeconds: 10, name: "companion", state: "passed" } as const;
  const skipped = { ...passed, checkId: "c2", name: "docs", state: "skipped" } as const;

  it("labels the collapsed checks row with the summary's passed count, never fewer", () => {
    const summary = { failing: 1, passed: 6, pending: 0, state: "failing" } as const;
    expect(settledChecksLabel([passed, skipped], summary)).toBe("6 passed · 1 skipped");
    expect(settledChecksLabel([passed], { reason: "No token", state: "unavailable" })).toBe("1 passed");
  });

  it("counts review requests of connected accounts only", () => {
    const page = parsePullRequestListPage(reviewRequestedPage);
    expect(reviewRequestedCount(page)).toBe(2);
    expect(reviewRequestedCount(page === null ? null : { ...page, sections: [] })).toBe(0);
    expect(reviewRequestedCount(null)).toBe(0);
  });
});

describe("review outcome copy", () => {
  it("reports a known verdict as done and keeps each count with its noun", () => {
    expect(publishedTitle("Approve", "github.com")).toBe("Approved on github.com");
    expect(publishedTitle("Request changes", "github.com")).toBe("Changes requested on github.com");
    expect(publishedTitle("Sticky ship", "a.yandex-team.ru")).toBe("Review published on a.yandex-team.ru · Sticky ship");
    const detail = publishedDetail({ left: 1, published: 2, toAgent: 1 });
    expect(detail.split(" · ")).toEqual(["2 published", "1 to agent", "1 left"]);
  });

  it("does not repeat a guide summary that equals the stop title", () => {
    expect(stopNarration({ prose: null, summary: "Map token expiry", title: "Map token expiry" })).toBeNull();
    expect(stopNarration({ prose: null, summary: "Maps expiry to AuthRequired", title: "Map token expiry" })).toBe("Maps expiry to AuthRequired");
    expect(stopNarration({ prose: "Check the host is redacted.", summary: "Map token expiry", title: "Map token expiry" })).toBe("Check the host is redacted.");
  });
});
