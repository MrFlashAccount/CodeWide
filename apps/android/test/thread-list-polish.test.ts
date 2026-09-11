import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sourceObjectDeclaration } from "./source-contract";

const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
const costPopover = readFileSync(
  new URL("../src/ui/CostBreakdownPopover.tsx", import.meta.url),
  "utf8",
);

describe("thread list visual contract", () => {
  it("keeps the unread marker with the timestamp instead of the title", () => {
    expect(screen).toMatch(
      /<View style=\{styles\.threadMeta\}>[\s\S]*styles\.unreadSlot[\s\S]*testID="thread-time"[\s\S]*<\/View>/u,
    );
  });

  it("gives thread search the remaining header width", () => {
    expect(screen).toMatch(
      /sidebarHeader: \{[^}]*paddingLeft: spacing\.md[^}]*paddingRight: threadListLayout\.edgeInset/u,
    );
    // The search controls and thread cards must share their outer right edge.
    expect(screen).toMatch(/threadRow: \{[^}]*marginHorizontal: threadListLayout\.edgeInset/u);
    expect(screen).toMatch(
      /threadSearchRow: \{[^}]*width: "100%"[^}]*minWidth: 0[^}]*flexDirection: "row"[^}]*alignItems: "center"[^}]*gap: spacing\.optical[^}]*\}/u,
    );
    expect(screen).toMatch(
      /threadFilterButton: \{[^}]*width: controlSize\.touch[^}]*minHeight: controlSize\.touch/u,
    );
    expect(screen).not.toContain("threadFilterButtonActive:");
    expect(screen).not.toContain("thread-filter-active-count");
    expect(screen).toContain('testID="thread-filter-active-dot"');
    expect(screen).toMatch(/threadFilterButton: \{[^}]*position: "relative"[^}]*\}/u);
    expect(screen).not.toMatch(/threadFilterButton: \{[^}]*backgroundColor/u);
    const filterMenu = screen.slice(
      screen.indexOf("function ThreadFilterMenu("),
      screen.indexOf("function ThreadListSuspenseFallback("),
    );
    expect(filterMenu).toContain("<ActionMenu");
    expect(filterMenu).toContain("menuWidth={344}");
    expect(filterMenu).not.toContain("<AppListRow");
    expect(filterMenu).not.toContain("<ControlOption");
    expect(filterMenu).not.toContain("threadFilterPanel");
  });

  it("keeps the title and search rows visually close without shrinking touch targets", () => {
    expect(sourceObjectDeclaration(screen, "sidebarHeader")).toContain(
      "paddingBottom: spacing.xxs",
    );
    expect(sourceObjectDeclaration(screen, "serverTitleRow")).toContain(
      "minHeight: touchTarget",
    );
    expect(sourceObjectDeclaration(screen, "mobileTitleRow")).toContain(
      "minHeight: touchTarget",
    );
  });

  it("shows the interactive cost without link-like underlining", () => {
    const triggerStyle = costPopover.match(/trigger: \{([^}]+)\}/u)?.[1] ?? "";
    expect(triggerStyle).not.toContain("textDecoration");
  });
});
