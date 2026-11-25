import type { ReactElement } from "react";
import type { ActionMenuProps } from "./ActionMenu.types";

/** A recycled row's identity, trigger and actions for its transient native popup. */
export type RowActionMenuProps = Pick<ActionMenuProps, "actions" | "onSelect"> & {
  /** Square accessory anchor in dp. Omit for a whole-row long press. */
  readonly buttonSize?: number;
  readonly children: (open: (() => void) | undefined) => ReactElement;
  readonly rowKey: string;
};
