import type { ReactElement } from "react";
import type { ActionMenuProps } from "../../ui/ActionMenu.types";

/** A recycled row's identity, trigger and actions for its transient native popup. */
export type ThreadRowMenuProps = Pick<ActionMenuProps, "actions" | "onSelect"> & {
  readonly children: (onLongPress: (() => void) | undefined) => ReactElement;
  readonly rowKey: string;
};
