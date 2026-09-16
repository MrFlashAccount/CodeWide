import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sourceObjectDeclaration } from "./source-contract";

const sidebarStyles = readFileSync(
  new URL("../src/features/threadList/ThreadSidebar.styles.ts", import.meta.url),
  "utf8",
);
const mobileStyles = readFileSync(
  new URL("../src/features/threadList/MobileThreads.styles.ts", import.meta.url),
  "utf8",
);
const rowStyles = readFileSync(
  new URL("../src/features/threadList/ThreadRow.styles.ts", import.meta.url),
  "utf8",
);
const menuStyles = readFileSync(
  new URL("../src/features/threadList/ThreadListMenus.styles.ts", import.meta.url),
  "utf8",
);
const menus = readFileSync(
  new URL("../src/features/threadList/ThreadListMenus.tsx", import.meta.url),
  "utf8",
);
const rowContent = readFileSync(
  new URL("../src/features/threadList/ThreadRowContent.tsx", import.meta.url),
  "utf8",
);

const costMenu = readFileSync(
  new URL("../src/features/accounts/CostBreakdownMenu.tsx", import.meta.url),
  "utf8",
);

describe("thread list visual contract", () => {
  it("keeps the unread marker with the timestamp instead of the title", () => {
    expect(rowContent).toMatch(
      /<View style=\{styles\.threadMeta\}>[\s\S]*styles\.unreadSlot[\s\S]*testID="thread-time"[\s\S]*<\/View>/u,
    );
  });

  it("gives thread search the remaining header width", () => {
    expect(sidebarStyles).toMatch(
      /sidebarHeader: \{[^}]*paddingLeft: spacing\.md[^}]*paddingRight: threadListLayout\.edgeInset/u,
    );
    // The search controls and thread cards must share their outer right edge.
    expect(rowStyles).toMatch(/threadRow: \{[^}]*marginHorizontal: threadListLayout\.edgeInset/u);
    const searchRowStyle = sourceObjectDeclaration(sidebarStyles, "threadSearchRow");
    for (const declaration of [
      'width: "100%"',
      "minWidth: 0",
      'flexDirection: "row"',
      'alignItems: "center"',
      "gap: spacing.optical",
    ]) {
      expect(searchRowStyle).toContain(declaration);
    }
    const filterButtonStyle = sourceObjectDeclaration(menuStyles, "threadFilterButton");
    expect(filterButtonStyle).toContain("width: controlSize.touch");
    expect(filterButtonStyle).toContain("minHeight: controlSize.touch");
    expect(menuStyles).not.toContain("threadFilterButtonActive:");
    expect(menuStyles).not.toContain("thread-filter-active-count");
    expect(menus).toContain('testID="thread-filter-active-dot"');
    expect(menuStyles).toMatch(/threadFilterButton: \{[^}]*position: "relative"[^}]*\}/u);
    expect(menuStyles).not.toMatch(/threadFilterButton: \{[^}]*backgroundColor/u);
    const filterMenu = menus.slice(menus.indexOf("function ThreadFilterMenu("));
    expect(filterMenu).toContain("<ActionMenu");
    expect(filterMenu).toContain("menuWidth={344}");
    expect(filterMenu).not.toContain("<AppListRow");
    expect(filterMenu).not.toContain("<ControlOption");
    expect(filterMenu).not.toContain("threadFilterPanel");
  });

  it("keeps the title and search rows visually close without shrinking touch targets", () => {
    expect(sourceObjectDeclaration(sidebarStyles, "sidebarHeader")).toContain(
      "paddingBottom: spacing.xxs",
    );
    expect(sourceObjectDeclaration(sidebarStyles, "serverTitleRow")).toContain(
      "minHeight: touchTarget",
    );
    expect(sourceObjectDeclaration(mobileStyles, "mobileTitleRow")).toContain(
      "minHeight: touchTarget",
    );
  });

  it("shows the interactive cost without link-like underlining", () => {
    expect(costMenu).not.toContain("textDecoration");
  });
});
