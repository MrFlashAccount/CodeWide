import type { ReactElement, ReactNode } from "react";
import type { PressableProps } from "react-native";

/** Anchored presentation only; callers own content, data and open-state effects. */
export interface ContentMenuProps {
  readonly align?: "start" | "center" | "end";
  readonly children: ReactNode;
  /**
   * Bounds of the popup's height. The menu sizes itself to its body between
   * them and scrolls beyond `maxHeight`; `maxHeight` defaults to the window's
   * anchored-menu bound.
   */
  readonly maxHeight?: number;
  readonly minHeight?: number;
  onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly placement?: "top" | "bottom" | "left" | "right";
  readonly trigger: ReactElement<PressableProps>;
  readonly width: number;
}
