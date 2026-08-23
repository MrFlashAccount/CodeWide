import { describe, expect, it } from "vitest";

import {
  mergeFailedComposerAttachments,
  mergeFailedComposerText,
  rollbackOwnedModelSelection,
} from "../src/data/composer-mutation-recovery";

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

  it("rolls back model independently when a newer effort mutation owns effort", () => {
    expect(rollbackOwnedModelSelection(
      { model: "m1", effort: "e2" },
      { model: "m1", effort: "e1" },
      { model: "m0", effort: "e0" },
      { model: true, effort: false },
    )).toEqual({ model: "m0", effort: "e2" });
  });

  it("does not roll back a field whose value has already changed", () => {
    expect(rollbackOwnedModelSelection(
      { model: "m2", effort: "e2" },
      { model: "m1", effort: "e1" },
      { model: "m0", effort: "e0" },
      { model: true, effort: true },
    )).toEqual({ model: "m2", effort: "e2" });
  });
});
