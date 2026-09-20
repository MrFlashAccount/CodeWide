import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { threadListLayout } from "../src/ui/thread-list-layout";
import { spacing } from "../src/theme";
import { sourceObjectDeclaration } from "./source-contract";

const header = readFileSync(
  new URL("../src/presentation/navigation/ThreadListHeader.tsx", import.meta.url),
  "utf8",
);
const rowStyles = readFileSync(
  new URL("../src/features/threadList/ThreadRow.styles.ts", import.meta.url),
  "utf8",
);

// The header title and row contents share one left axis. The outer edge remains
// a separate contract because the swipe wrapper owns the card margin on Android.
describe("V1 sidebar alignment", () => {
  it("aligns the shared Threads title with thread-row contents", () => {
    const declaration = sourceObjectDeclaration(header, "row");
    expect(declaration).toMatch(/paddingLeft: spacing\.md/);
    expect(declaration).toMatch(/paddingRight: threadListLayout\.edgeInset/);
    expect(declaration).not.toMatch(/paddingHorizontal:/);
    expect(threadListLayout.edgeInset + spacing.xs).toBe(spacing.md);
  });

  it.each(["threadRow", "swipeContainer"])("keeps %s on the existing compact card edge", (name) => {
    const declaration = sourceObjectDeclaration(rowStyles, name);
    expect(declaration).toMatch(/marginHorizontal: threadListLayout\.edgeInset/);
    expect(threadListLayout.edgeInset).toBe(spacing.xs);
  });
});
