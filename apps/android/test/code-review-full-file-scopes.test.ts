import { describe, expect, it, vi } from "vitest";

vi.mock("../src/rendering/DocumentPreviewHost", () => ({
  loadDocumentPreview: async () => {
    throw new Error("Private file request failed");
  },
}));

import { loadCodeReviewResource } from "../src/features/review/resources/reviewResource";
import type { ThreadChangeScope } from "../src/data/workspace-resource-database";

const path = "/repo/example.ts";
const change = {
  additions: 1,
  availability: "available" as const,
  deletions: 1,
  itemId: "item",
  kind: "update" as const,
  path,
  turnId: "turn",
};

async function review(
  scope: ThreadChangeScope,
  diffSource: string | null,
  withSourceOverride = true,
) {
  return loadCodeReviewResource(
    change,
    scope,
    async () => {
      throw new Error("Source override should avoid transfer access");
    },
    async () => ({
      changeScope: scope,
      patches: [
        { diff: "@@ -1 +1 @@\n-old\n+new\n", itemId: "item", kind: "update", turnId: "turn" },
      ],
      path,
      source: diffSource,
      threadId: "thread",
      truncated: false,
    }),
    new AbortController().signal,
    withSourceOverride ? { [path]: "new\ncontext\n" } : undefined,
    () => undefined,
    undefined,
  );
}

describe("complete file review scopes", () => {
  it.each(["session", "uncommitted", "branch"] as const)(
    "%s retains the full file with its diff",
    async (scope) => {
      const result = await review(scope, null);
      expect(result.document.source).toBe("new\ncontext\n");
      expect(result.document.fullFileDiff).toBe(true);
      expect(result.document.patches).toHaveLength(1);
    },
  );

  it("leaves recorded Turn changes as recorded patches", async () => {
    const result = await review("lastTurn", "");
    expect(result.document.fullFileDiff).toBeUndefined();
    expect(result.document.source).toBe("");
    expect(result.document.patches).toHaveLength(1);
  });

  it("uses the complete VCS source when the separate file request fails", async () => {
    const result = await review("branch", "new\ncontext\n", false);
    expect(result.document.source).toBe("new\ncontext\n");
    expect(result.document.fullFileDiff).toBe(true);
  });

  it("reports a missing Session source instead of presenting an error as file content", async () => {
    await expect(review("session", null, false)).rejects.toThrow("Private file request failed");
  });
});
