import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import { colors, controlHitSlop, controlSize, iconSize } from "../../../theme";
import { ActionMenu } from "../../../ui/ActionMenu";
import type { ActionMenuItem } from "../../../ui/ActionMenu.types";

const NO_EXTRA_ITEMS: readonly ExtraMenuItem[] = [];

/** Extra menu entries that are not catalog actions, such as Open on forge. */
export type ExtraMenuItem = {
  readonly id: string;
  readonly label: string;
  readonly onSelect: () => void;
};

/**
 * `⋯` menu of overflowed actions in plugin order. A disabled action keeps its
 * reason as the description; destructive kinds are marked destructive.
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
    ...actions.map((action) => ({
      ...(action.availability.state === "disabled"
        ? { description: action.availability.reason, disabled: true }
        : {}),
      ...(action.kind === "close" || action.kind === "merge" || action.confirm === "destructive"
        ? { destructive: true }
        : {}),
      id: `action:${action.actionId}`,
      label: action.label,
    })),
    ...extra.map((item) => ({ id: `extra:${item.id}`, label: item.label })),
  ];
  return (
    <ActionMenu
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
    >
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        hitSlop={compact ? controlHitSlop.compact : undefined}
        style={compact ? styles.compact : styles.regular}
      >
        <Ionicons color={colors.text} name="ellipsis-horizontal" size={iconSize.action} />
      </Pressable>
    </ActionMenu>
  );
}

const styles = StyleSheet.create({
  compact: {
    alignItems: "center",
    height: controlSize.compact,
    justifyContent: "center",
    width: controlSize.compact,
  },
  regular: {
    alignItems: "center",
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
});
