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
  return "Branch";
}

export function changeScopeMenuActions(
  scopes: readonly ThreadChangeScope[],
  selectedScope: ThreadChangeScope,
): ActionMenuItem[] {
  return scopes.map((scope) => ({
    id: `scope:${scope}`,
    label: changeScopeTitle(scope),
    section: "Changes",
    selected: selectedScope === scope,
  }));
}
