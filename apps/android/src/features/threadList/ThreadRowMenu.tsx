import type { ReactElement } from "react";
import type { ThreadRowMenuProps } from "./ThreadRowMenu.types";

/** Browser rows retain their existing sheet and long-press handler. */
export function ThreadRowMenu({ children }: ThreadRowMenuProps): ReactElement {
  return children(undefined);
}
