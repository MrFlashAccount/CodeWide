import { describe, expect, it } from "vitest";

import { changeScopeMenuActions, codeReviewMenuActions } from "../src/rendering/change-menu";

const scopes = ["session", "lastTurn", "staged", "unstaged", "branch"] as const;

describe("Changes menus", () => {
  it("keeps the composer Changes chip limited to scope selection", () => {
    expect(changeScopeMenuActions(scopes, "unstaged")).toEqual([
      { id: "scope:session", section: "Changes", label: "Session", selected: false },
      { id: "scope:lastTurn", section: "Changes", label: "Last turn", selected: false },
      { id: "scope:staged", section: "Changes", label: "Staged", selected: false },
      { id: "scope:unstaged", section: "Changes", label: "Unstaged", selected: true },
      { id: "scope:branch", section: "Changes", label: "Branch", selected: false },
    ]);
  });

  it("keeps layout and display controls in the code review menu", () => {
    expect(codeReviewMenuActions(scopes, "branch", "split", true)).toEqual([
      { id: "scope:session", section: "Changes", label: "Session", selected: false },
      { id: "scope:lastTurn", section: "Changes", label: "Last turn", selected: false },
      { id: "scope:staged", section: "Changes", label: "Staged", selected: false },
      { id: "scope:unstaged", section: "Changes", label: "Unstaged", selected: false },
      { id: "scope:branch", section: "Changes", label: "Branch", selected: true },
      { id: "view:unified", section: "Layout", label: "Unified", selected: false },
      { id: "view:split", section: "Layout", label: "Split", selected: true },
      { id: "view:source", section: "Layout", label: "File", selected: false },
      { id: "wrap", section: "Display", label: "Wrap lines", selected: true },
    ]);
  });
});
