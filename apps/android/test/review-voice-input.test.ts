import { describe, expect, it } from "vitest";

import {
  codeReviewVoiceInputScope,
  type CodeReviewLineReference,
} from "../src/features/review/comments/reviewComment";

describe("review voice input", () => {
  it("keeps a line's voice identity stable and isolates other lines, files, windows and threads", () => {
    const line: CodeReviewLineReference = { path: "a.ts", line: 7, side: "new" };
    const scope = codeReviewVoiceInputScope("thread-a", "window-a", line);
    expect(
      codeReviewVoiceInputScope("thread-a", "window-a", {
        ...line,
        column: 2,
        context: "changed display context",
      }),
    ).toBe(scope);
    const otherScopes = [
      codeReviewVoiceInputScope("thread-b", "window-a", line),
      codeReviewVoiceInputScope("thread-a", "window-b", line),
      codeReviewVoiceInputScope("thread-a", "window-a", { ...line, line: 8 }),
      codeReviewVoiceInputScope("thread-a", "window-a", { ...line, path: "b.ts" }),
      codeReviewVoiceInputScope("thread-a", "window-a", { ...line, side: "old" }),
      codeReviewVoiceInputScope("thread-a", "window-a", { ...line, coordinate: "diff" }),
    ];
    expect(otherScopes).not.toContain(scope);
    expect(new Set(otherScopes).size).toBe(otherScopes.length);
  });
});
