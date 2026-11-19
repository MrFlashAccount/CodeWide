import type { ActionDescriptor, ActionKind } from "../../../data/forgeActionCatalog";
import type { ActionMenuIconName, ActionMenuItem } from "../../../ui/ActionMenu.types";
import { OverflowMenu } from "../../../ui/OverflowMenu";

const NO_EXTRA_ITEMS: readonly ExtraMenuItem[] = [];

const ACTION_ICONS: Readonly<Record<ActionKind, ActionMenuIconName>> = {
  addressComments: "chatbubbles-outline",
  autoMerge: "git-network-outline",
  close: "close-circle-outline",
  extension: "extension-puzzle-outline",
  fixCi: "build-outline",
  merge: "git-merge-outline",
  rebase: "git-branch-outline",
  reviewPr: "reader-outline",
  updateBranch: "sync-outline",
  verdict: "checkbox-outline",
};

/** Menu entries that are not catalog actions, such as Copy link or Open in the forge. */
export type ExtraMenuItem = {
  readonly icon: ActionMenuIconName;
  readonly id: string;
  readonly label: string;
  readonly onSelect: () => void;
};

/**
 * `⋮` menu: the `extra` entries first, then the overflowed actions in plugin order. A disabled
 * action keeps its reason as the description; destructive kinds (Close, a plugin's Discard) are
 * marked destructive and still confirm through the runner's destructive floor.
 */
export function OverflowActionsMenu({
  accessibilityLabel,
  actions,
  compact = false,
  extra = NO_EXTRA_ITEMS,
  onRun,
}: {
  readonly accessibilityLabel: string;
  readonly actions: readonly ActionDescriptor[];
  readonly compact?: boolean;
  readonly extra?: readonly ExtraMenuItem[];
  readonly onRun: (action: ActionDescriptor) => void;
}): React.JSX.Element | null {
  if (actions.length === 0 && extra.length === 0) {
    return null;
  }
  const items: ActionMenuItem[] = [
    ...extra.map((item) => ({ icon: item.icon, id: `extra:${item.id}`, label: item.label })),
    ...actions.map((action) => ({
      ...(action.availability.state === "disabled"
        ? { description: action.availability.reason, disabled: true }
        : {}),
      ...(action.kind === "close" || action.kind === "merge" || action.confirm === "destructive"
        ? { destructive: true }
        : {}),
      icon: ACTION_ICONS[action.kind],
      id: `action:${action.actionId}`,
      label: action.label,
    })),
  ];
  return (
    <OverflowMenu
      accessibilityLabel={accessibilityLabel}
      actions={items}
      align="end"
      onSelect={(id) => {
        const action = actions.find((candidate) => `action:${candidate.actionId}` === id);
        if (action !== undefined) {
          onRun(action);
          return;
        }
        extra.find((item) => `extra:${item.id}` === id)?.onSelect();
      }}
      placement="bottom"
      size={compact ? "compact" : "touch"}
    />
  );
}
