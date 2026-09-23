import type { ThreadChangeScope } from "../data/workspace-resource-database";
import type { ActionMenuItem } from "../ui/ActionMenu";

export function changeScopeTitle(scope: ThreadChangeScope): string {
  if (scope === "session") {
    return "Session";
  }
  if (scope === "lastTurn") {
    return "Last turn";
  }
  if (scope === "staged") {
    return "Staged";
  }
  if (scope === "unstaged") {
    return "Unstaged";
  }
  if (scope === "uncommitted") {
    return "Uncommitted";
  }
  return "Branch";
}

const SELECTABLE_CHANGE_SCOPES = ["session", "uncommitted", "branch"] as const;

export function isSelectableChangeScope(scope: ThreadChangeScope): boolean {
  return SELECTABLE_CHANGE_SCOPES.some((candidate) => candidate === scope);
}

export function selectableChangeScopes(scopes: readonly ThreadChangeScope[]): ThreadChangeScope[] {
  return SELECTABLE_CHANGE_SCOPES.filter((scope) => scopes.includes(scope));
}

export function changeScopeMenuActions(
  scopes: readonly ThreadChangeScope[],
  selectedScope: ThreadChangeScope,
): ActionMenuItem[] {
  return selectableChangeScopes(scopes).map((scope) => ({
    id: `scope:${scope}`,
    label: changeScopeTitle(scope),
    section: "Changes",
    selected: selectedScope === scope,
  }));
}
