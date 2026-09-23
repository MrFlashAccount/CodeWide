import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sourceObjectDeclaration } from "./source-contract";

const header = readFileSync(
  new URL("../src/presentation/navigation/ThreadListHeader.tsx", import.meta.url),
  "utf8",
);
const sidebarHeader = readFileSync(
  new URL("../src/features/threadList/ThreadSidebarHeader.tsx", import.meta.url),
  "utf8",
);
const mobileHeader = readFileSync(
  new URL("../src/features/threadList/MobileThreadsHeader.tsx", import.meta.url),
  "utf8",
);
const searchRow = readFileSync(
  new URL("../src/features/threadList/ThreadListSearchRow.tsx", import.meta.url),
  "utf8",
);
const rowStyles = readFileSync(
  new URL("../src/features/threadList/ThreadRow.styles.ts", import.meta.url),
  "utf8",
);
const filterButtonLayout = readFileSync(
  new URL("../src/presentation/input/filterIconButtonLayout.ts", import.meta.url),
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

  it("keeps filtering in the header and search in the fixed second row", () => {
    const headerRowStyle = sourceObjectDeclaration(header, "row");
    expect(headerRowStyle).toContain("paddingRight: threadListLayout.edgeInset");
    expect(headerRowStyle).toContain("minHeight: layoutSize.header");
    // Header actions and thread cards must share their outer right edge.
    expect(rowStyles).toMatch(/threadRow: \{[^}]*marginHorizontal: threadListLayout\.edgeInset/u);
    expect(filterButtonLayout).toContain("width: controlSize.touch");
    expect(filterButtonLayout).toContain("minHeight: controlSize.touch");
    expect(header).toContain("action: filterIconButtonLayout");
    expect(menus).toContain('testID="thread-filter-active-dot"');
    expect(menus).toContain("<ThreadListHeaderAction");
    expect(searchRow).toContain("...searchFieldLayout");
    expect(searchRow).toContain('testID="thread-search-row"');
    expect(filterButtonLayout).toContain('position: "relative"');
    expect(filterButtonLayout).not.toContain("backgroundColor");
    for (const owner of [sidebarHeader, mobileHeader]) {
      expect(owner).toContain("<ThreadListSearchRow onOpenSearch={onOpenSearch} />");
      expect(owner).not.toContain("mobileSearchWrap");
    }
    const filterMenu = menus.slice(menus.indexOf("function ThreadFilterMenu("));
    expect(filterMenu).toContain("<ActionMenu");
    expect(filterMenu).toContain("menuWidth={344}");
    expect(filterMenu).not.toContain("<AppListRow");
    expect(filterMenu).not.toContain("<ControlOption");
    expect(filterMenu).not.toContain("threadFilterPanel");
  });

  it("uses the same header row owner on compact, expanded and Search surfaces", () => {
    expect(sidebarHeader).toContain('<ThreadListHeaderRow testID="thread-list-header-row">');
    expect(mobileHeader).toContain('<ThreadListHeaderRow testID="thread-list-header-row">');
    expect(sourceObjectDeclaration(header, "row")).toContain("minHeight: layoutSize.header");
  });

  it("shows the interactive cost without link-like underlining", () => {
    expect(costMenu).not.toContain("textDecoration");
  });
});
