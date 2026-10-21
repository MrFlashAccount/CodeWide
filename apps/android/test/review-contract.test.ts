import { describe, expect, it } from "vitest";

import { diffSourceKey, parseHunkCatalog } from "../src/data/reviewContract";
import { parseDrafts } from "../src/data/reviewDraftContract";
import { parseGuideState } from "../src/data/reviewGuideContract";
import { draftsSnapshot, guideState, prDraft } from "./fixtures/forgeWireFixtures";

describe("review drafts contract", () => {
  it("keeps exactly the axes each destination has", () => {
    const drafts = parseDrafts(draftsSnapshot)?.drafts ?? [];
    expect(drafts.map((draft) => [draft.destination, "pr" in draft, "agent" in draft])).toEqual([
      ["pr", true, false],
      ["both", true, true],
      ["agent", false, true],
    ]);
  });

  it("rejects a PR destination on a session source", () => {
    const sessionDraft = prDraft("s1", {
      destination: "pr",
      pr: { state: "pending" },
      revision: { revision: "turn-1", source: { kind: "session", resource: "lastTurn", threadId: "thread-1" } },
      sourceKind: "session",
    });
    expect(parseDrafts({ drafts: [sessionDraft], revision: "turn-1" })).toBeNull();
  });
});

describe("review guide contract", () => {
  it("parses the guide with stop progress, a stop absent from progress being pending", () => {
    const state = parseGuideState(guideState);
    expect(state?.guide?.chapters[0]?.stops.map((stop) => stop.stopId)).toEqual(["s1", "s2"]);
    expect(state?.progress).toEqual({ s1: "accepted", s2: "changed" });
  });

  it("accepts only the two guide error codes", () => {
    const at = "2026-10-21T09:00:00Z";
    expect(parseGuideState({ ...guideState, lastError: { at, code: -32_085, reason: "Unknown hunk h7" } })?.lastError?.code).toBe(-32_085);
    expect(parseGuideState({ ...guideState, lastError: { at, code: -32_000, reason: "x" } })).toBeNull();
  });
});

describe("diff sources", () => {
  it("gives distinct keys to sources that differ in any identity field", () => {
    const keys = new Set([
      diffSourceKey({ kind: "pullRequest", pullRequest: parseKey("fpr1.a") }),
      diffSourceKey({ kind: "vcs", scope: "staged", workspace: "/w" }),
      diffSourceKey({ kind: "vcs", scope: "branch", workspace: "/w" }),
    ]);
    expect(keys.size).toBe(3);
  });

  it("parses a hunk catalog", () => {
    expect(parseHunkCatalog({ files: [], revision: "r1" })).toEqual({ files: [], revision: "r1" });
  });
});

function parseKey(value: string) {
  const parsed = parseDrafts({
    drafts: [prDraft("k", { destination: "pr", pr: { state: "pending" }, revision: { revision: "r", source: { kind: "pullRequest", pullRequest: value } } })],
    revision: "r",
  });
  const source = parsed?.drafts[0]?.revision.source;
  if (source?.kind !== "pullRequest") {
    throw new Error("fixture must parse");
  }
  return source.pullRequest;
}
