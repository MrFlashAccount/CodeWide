import { describe, expect, it } from "vitest";

import { threadListLayout } from "../src/ui/thread-list-layout";
import { spacing } from "../src/theme";

// The header title and row contents share one left axis. The outer edge remains
// a separate contract because the swipe wrapper owns the card margin on Android.
describe("V1 sidebar alignment", () => {
  it("aligns the shared Threads title with thread-row contents", () => {
    expect(threadListLayout.edgeInset + spacing.xs).toBe(spacing.md);
  });

  it.each(["threadRow", "swipeContainer"])("keeps %s on the existing compact card edge", () => {
    expect(threadListLayout.edgeInset).toBe(spacing.xs);
  });
});
