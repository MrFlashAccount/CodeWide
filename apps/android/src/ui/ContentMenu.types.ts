import type { ReactElement, ReactNode } from "react";
import type { PressableProps } from "react-native";

/** Anchored presentation only; callers own content, data and open-state effects. */
export interface ContentMenuProps {
  readonly align?: "start" | "center" | "end";
  readonly children: ReactNode;
  onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly placement?: "top" | "bottom" | "left" | "right";
  readonly trigger: ReactElement<PressableProps>;
  readonly width: number;
}
