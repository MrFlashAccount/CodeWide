import type { ThreadChangeScope } from "../../../data/workspace-resource-database";
import { changeScopeMenuActions } from "../../../rendering/change-menu";
import type { ActionMenuItem } from "../../../ui/ActionMenu";
import type { CodeReviewViewMode } from "../editor/editorBridge";

type CodeReviewMenuInput = {
  readonly mode: CodeReviewViewMode;
  readonly scopes: readonly ThreadChangeScope[];
  readonly selectedScope: ThreadChangeScope;
  readonly wrapLines: boolean;
};

/** Build the complete menu for the code review workspace. */
export function codeReviewMenuActions({
  mode,
  scopes,
  selectedScope,
  wrapLines,
}: CodeReviewMenuInput): ActionMenuItem[] {
  return [
    ...changeScopeMenuActions(scopes, selectedScope),
    { id: "view:unified", label: "Unified", section: "Layout", selected: mode === "unified" },
    { id: "view:split", label: "Split", section: "Layout", selected: mode === "split" },
    { id: "view:source", label: "File", section: "Layout", selected: mode === "source" },
    { id: "wrap", label: "Wrap lines", section: "Display", selected: wrapLines },
  ];
}
