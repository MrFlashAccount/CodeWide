import { describe, expect, it } from "vitest";

import {
  mergeFailedComposerAttachments,
  mergeFailedComposerText,
} from "../src/features/composer/submissionRecovery";

describe("composer async mutation recovery", () => {
  it("preserves every failed concurrent send without overwriting newer input", () => {
    let draft = "new unsent text";
    draft = mergeFailedComposerText(draft, "first failed send");
    draft = mergeFailedComposerText(draft, "second failed send");

    expect(draft).toBe("second failed send\n\nfirst failed send\n\nnew unsent text");
  });

  it("deduplicates failed attachments while retaining newer attachments", () => {
    const current = [{ id: "new" }, { id: "shared" }];
    const recovered = mergeFailedComposerAttachments(current, [{ id: "old" }, { id: "shared" }]);

    expect(recovered.map(({ id }) => id)).toEqual(["old", "shared", "new"]);
  });
});
