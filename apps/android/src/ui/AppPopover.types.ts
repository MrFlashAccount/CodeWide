import type { ReactElement, ReactNode } from "react";
import type { PressableProps } from "react-native";

/** Anchored presentation only; callers own content, data and open-state effects. */
export interface AppPopoverProps {
  readonly trigger: ReactElement<PressableProps>;
  readonly children: ReactNode;
  readonly open: boolean;
  readonly width: number;
  readonly placement?: "top" | "bottom" | "left" | "right";
  readonly align?: "start" | "center" | "end";
  onOpenChange(open: boolean): void;
}
