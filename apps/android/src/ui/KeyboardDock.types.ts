import type { ReactNode } from "react";

/** Props of the keyboard dock layer. */
export type KeyboardDockProps = {
  /** Docked at the bottom; a child with `flex: 1` fills the space above the keyboard. */
  readonly children: ReactNode;
};
