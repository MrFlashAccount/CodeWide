import type { ReactElement } from "react";
import type { RowActionMenuProps } from "./RowActionMenu.types";

/** Non-native consumers retain their existing context-menu presentation. */
export function RowActionMenu({ children }: RowActionMenuProps): ReactElement {
  return children(undefined);
}
