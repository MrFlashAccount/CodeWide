import { ActionMenu } from "./ActionMenu";
import type { ActionMenuProps } from "./ActionMenu.types";
import {
  OverflowMenuButton,
  type OverflowMenuSize,
  type OverflowMenuTone,
} from "./OverflowMenuButton";

/** `ActionMenu` options plus the shared trigger's appearance; the label names both. */
export type OverflowMenuProps = Omit<ActionMenuProps, "children" | "trigger"> & {
  readonly busy?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly size?: OverflowMenuSize | undefined;
  readonly testID?: string | undefined;
  readonly tone?: OverflowMenuTone | undefined;
};

/**
 * The standard `⋮` actions menu: `ActionMenu` opened by `OverflowMenuButton`.
 * `style` positions the menu anchor; the trigger's look is `tone` and `size`.
 */
export function OverflowMenu({
  accessibilityLabel,
  busy,
  disabled,
  size,
  testID,
  tone,
  ...menu
}: OverflowMenuProps): React.JSX.Element {
  return (
    <ActionMenu accessibilityLabel={accessibilityLabel} {...menu}>
      <OverflowMenuButton
        accessibilityLabel={accessibilityLabel}
        busy={busy}
        disabled={disabled}
        size={size}
        testID={testID}
        tone={tone}
      />
    </ActionMenu>
  );
}
