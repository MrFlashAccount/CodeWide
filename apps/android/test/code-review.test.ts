import { describe, expect, it } from "vitest";

import {
  codeReviewDocumentRevision,
  codeReviewWorkspaceRevision,
  type CodeReviewFileItem,
} from "../src/rendering/code-review-bridge";
import { serializeCodeReviewAttachment } from "../src/rendering/code-review";

describe("code review contracts", () => {
  it("serializes many line comments into one review attachment", () => {
    const attachment = serializeCodeReviewAttachment([
      { id: "two", path: "src/b.ts", line: 9, side: "old", body: "Why remove this?", createdAt: 2 },
      { id: "one", path: "src/a.ts", line: 3, side: "new", body: "Please extract this.", createdAt: 1 },
    ]);
    expect(attachment).toContain("kind: codewide-code-review");
    expect(attachment).toContain("comments: 2");
    expect(attachment.indexOf("src/a.ts")).toBeLessThan(attachment.indexOf("src/b.ts"));
    expect(attachment).toContain("old line 9");
  });

  it("keys immutable documents by content instead of request identity", () => {
    const patches = [{ kind: "update" as const, diff: "@@ -1 +1 @@\n-old\n+new" }];
    const revision = codeReviewDocumentRevision("src/a.ts", "new", patches);
    expect(revision).toBe(codeReviewDocumentRevision("src/a.ts", "new", patches));
    expect(revision).not.toBe(codeReviewDocumentRevision("src/a.ts", "newer", patches));
    expect(revision).not.toBe(codeReviewDocumentRevision("src/a.ts", "new", [{ ...patches[0], diff: "@@ -1 +1 @@\n-a\n+b" }]));
  });

  it("changes the tree revision only when Pierre-visible file metadata changes", () => {
    const files: CodeReviewFileItem[] = [{ path: "/repo/a.ts", treePath: "a.ts", status: "modified", additions: 1, deletions: 2 }];
    expect(codeReviewWorkspaceRevision(files)).toBe(codeReviewWorkspaceRevision(files.map((file) => ({ ...file }))));
    expect(codeReviewWorkspaceRevision(files)).not.toBe(codeReviewWorkspaceRevision([{ ...files[0], additions: 3 }]));
  });
});
