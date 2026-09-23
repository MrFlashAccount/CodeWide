import { describe, expect, it } from "vitest";

import { codeReviewMenuActions } from "../src/features/review/workspace/codeReviewMenu";
import { changeScopeMenuActions } from "../src/rendering/change-menu";

const scopes = ["session", "lastTurn", "staged", "unstaged", "uncommitted", "branch"] as const;

describe("Changes menus", () => {
  it("keeps the composer Changes chip limited to scope selection", () => {
    expect(changeScopeMenuActions(scopes, "uncommitted")).toEqual([
      { id: "scope:session", section: "Changes", label: "Session", selected: false },
      { id: "scope:uncommitted", section: "Changes", label: "Uncommitted", selected: true },
      { id: "scope:branch", section: "Changes", label: "Branch", selected: false },
    ]);
  });

  it("keeps layout and display controls in the code review menu", () => {
    expect(
      codeReviewMenuActions({
        mode: "split",
        scopes,
        selectedScope: "branch",
        wrapLines: true,
      }),
    ).toEqual([
      { id: "scope:session", section: "Changes", label: "Session", selected: false },
      { id: "scope:uncommitted", section: "Changes", label: "Uncommitted", selected: false },
      { id: "scope:branch", section: "Changes", label: "Branch", selected: true },
      { id: "view:unified", section: "Layout", label: "Unified", selected: false },
      { id: "view:split", section: "Layout", label: "Split", selected: true },
      { id: "view:source", section: "Layout", label: "File", selected: false },
      { id: "wrap", section: "Display", label: "Wrap lines", selected: true },
    ]);
  });
});
