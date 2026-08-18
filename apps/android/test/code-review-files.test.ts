import { describe, expect, it } from "vitest";

import type { ThreadChangeResource } from "../src/data/workspace-resource-database";
import { codeReviewFilesForDocument } from "../src/rendering/code-review-files";

const change: ThreadChangeResource = {
  path: "/repo/src/existing.ts",
  kind: "update",
  availability: "available",
  additions: 3,
  deletions: 1,
  turnId: "turn-1",
  itemId: "item-1",
};

describe("code review attachment files", () => {
  it("selects a recorded change without replacing its diff metadata", () => {
    const files = codeReviewFilesForDocument([change], change.path);

    expect(files).toEqual([change]);
    expect(files[0]?.sourceOnly).toBeUndefined();
  });

  it("adds an attached code file as a source-only review file", () => {
    const files = codeReviewFilesForDocument([change], "/tmp/attached.py");

    expect(files).toHaveLength(2);
    expect(files[1]).toMatchObject({
      path: "/tmp/attached.py",
      availability: "available",
      sourceOnly: true,
    });
  });
});
