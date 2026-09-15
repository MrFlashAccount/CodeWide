import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { threadListLayout } from "../src/ui/thread-list-layout";
import { spacing } from "../src/theme";
import { sourceObjectDeclaration } from "./source-contract";

const sidebarStyles = readFileSync(new URL("../src/features/threadList/ThreadSidebar.styles.ts", import.meta.url), "utf8");
const mobileStyles = readFileSync(new URL("../src/features/threadList/MobileThreads.styles.ts", import.meta.url), "utf8");
const rowStyles = readFileSync(new URL("../src/features/threadList/ThreadRow.styles.ts", import.meta.url), "utf8");


// The outer edge is a shared visual contract. Check its production consumers,
// including the swipe wrapper which owns the card margin on Android.
describe("V1 sidebar outer edge", () => {
  it.each(["sidebarHeader", "mobileTitleRow", "mobileSearchWrap"])(
    "aligns %s controls with chat cards",
    (name) => {
      const declaration = sourceObjectDeclaration(name === "sidebarHeader" ? sidebarStyles : mobileStyles, name);
      expect(declaration).toMatch(/paddingRight: threadListLayout\.edgeInset/);
      expect(declaration).not.toMatch(/paddingHorizontal:/);
    },
  );

  it.each(["threadRow", "swipeContainer"])("keeps %s on the existing compact card edge", (name) => {
    const declaration = sourceObjectDeclaration(rowStyles, name);
    expect(declaration).toMatch(/marginHorizontal: threadListLayout\.edgeInset/);
    expect(threadListLayout.edgeInset).toBe(spacing.xs);
  });
});
