import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
const costPopover = readFileSync(new URL("../src/ui/CostBreakdownPopover.tsx", import.meta.url), "utf8");

describe("thread list visual contract", () => {
  it("keeps the unread marker with the timestamp instead of the title", () => {
    expect(screen).toMatch(/<View style=\{styles\.threadMeta\}>[\s\S]*styles\.unreadSlot[\s\S]*testID="thread-time"[\s\S]*<\/View>/u);
  });

  it("gives thread search the remaining header width", () => {
    expect(screen).toContain('sidebarHeader: { paddingLeft: spacing.sm, paddingRight: 0');
    expect(screen).toContain('threadSearchRow: { width: "100%", minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.xxs }');
    expect(screen).toContain('threadFilterButton: { width: 40, height: 44');
  });

  it("shows the interactive cost without link-like underlining", () => {
    const triggerStyle = costPopover.match(/trigger: \{([^}]+)\}/u)?.[1] ?? "";
    expect(triggerStyle).not.toContain("textDecoration");
  });
});
