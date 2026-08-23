import { describe, expect, it } from "vitest";

import {
  AUTO_ATTACH_PASTE_MIN_CHARS,
  captureClipboardLargePaste,
} from "../src/data/composer-paste-attachment";

describe("composer large-paste attachments", () => {
  it("preserves the replacement deletion when selected text is replaced", () => {
    const pasted = "z".repeat(AUTO_ATTACH_PASTE_MIN_CHARS + 1);
    expect(captureClipboardLargePaste("keep remove tail", pasted, { start: 5, end: 11 })).toEqual({
      attachmentText: pasted,
      draftText: "keep  tail",
      insertionOffset: 5,
      pastedDraftText: `keep ${pasted} tail`,
    });
  });

  it("does not convert a shorter insertion", () => {
    expect(captureClipboardLargePaste("", "x".repeat(AUTO_ATTACH_PASTE_MIN_CHARS - 1), null)).toBeNull();
  });

  it("keeps an exact-threshold insertion in the composer", () => {
    expect(captureClipboardLargePaste("", "x".repeat(AUTO_ATTACH_PASTE_MIN_CHARS), null)).toBeNull();
  });

  it("keeps the complete native clipboard payload in one attachment", () => {
    const pasted = "clipboard".repeat(20_000);
    const capture = captureClipboardLargePaste("before remove after", pasted, { start: 7, end: 13 });

    expect(capture).toEqual({
      attachmentText: pasted,
      draftText: "before  after",
      insertionOffset: 7,
      pastedDraftText: `before ${pasted} after`,
    });
  });
});
