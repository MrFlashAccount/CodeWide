import { controlSize } from "../theme";
import { OverflowMenu, type OverflowMenuProps } from "./OverflowMenu";
import { OverflowMenuButton } from "./OverflowMenuButton";
import { RowActionMenu } from "./RowActionMenu";

/** Row accessory whose Android popup exists only while this item's menu is open. */
export function RowOverflowMenu({
  accessibilityLabel,
  actions,
  onSelect,
  rowKey,
  size = "touch",
  tone,
}: Pick<OverflowMenuProps, "accessibilityLabel" | "actions" | "onSelect" | "size" | "tone"> & {
  readonly rowKey: string;
}): React.JSX.Element {
  return (
    <RowActionMenu
      actions={actions}
      buttonSize={controlSize[size]}
      key={rowKey}
      onSelect={onSelect}
      rowKey={rowKey}
    >
      {(open) =>
        open === undefined ? (
          <OverflowMenu
            accessibilityLabel={accessibilityLabel}
            actions={actions}
            onSelect={onSelect}
            size={size}
            tone={tone}
          />
        ) : (
          <OverflowMenuButton
            accessibilityLabel={accessibilityLabel}
            onPress={open}
            size={size}
            tone={tone}
          />
        )
      }
    </RowActionMenu>
  );
}
