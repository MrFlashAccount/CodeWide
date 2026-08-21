import type { ThreadChangeScope } from "../data/workspace-resource-database";
import type { ActionMenuItem } from "../ui/ActionMenu";
import type { CodeReviewViewMode } from "./code-review-bridge";

export function changeScopeTitle(scope: ThreadChangeScope): string {
  if (scope === "session") return "Session";
  if (scope === "lastTurn") return "Last turn";
  if (scope === "staged") return "Staged";
  if (scope === "unstaged") return "Unstaged";
  return "Branch";
}

export function changeScopeMenuActions(
  scopes: readonly ThreadChangeScope[],
  selectedScope: ThreadChangeScope,
): ActionMenuItem[] {
  return scopes.map((scope) => ({
    id: `scope:${scope}`,
    section: "Changes",
    label: changeScopeTitle(scope),
    selected: selectedScope === scope,
  }));
}

export function codeReviewMenuActions(
  scopes: readonly ThreadChangeScope[],
  selectedScope: ThreadChangeScope,
  mode: CodeReviewViewMode,
  wrapLines: boolean,
): ActionMenuItem[] {
  return [
    ...changeScopeMenuActions(scopes, selectedScope),
    { id: "view:unified", section: "Layout", label: "Unified", selected: mode === "unified" },
    { id: "view:split", section: "Layout", label: "Split", selected: mode === "split" },
    { id: "view:source", section: "Layout", label: "File", selected: mode === "source" },
    { id: "wrap", section: "Display", label: "Wrap lines", selected: wrapLines },
  ];
}
