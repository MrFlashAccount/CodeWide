import type { ViewProps } from "react-native";

export const ROW_ACTION_TAP_MAX_DISTANCE = 8;
export const ROW_ACTION_LONG_PRESS_DURATION = 350;
export const ROW_ACTION_PRESSED_OPACITY = 0.68;

/** Neutral row activation; layout and navigation stay with the caller. */
export type RowActionTriggerProps = ViewProps & {
  readonly gestureTestId: string;
  readonly onLongPress?: (() => void) | undefined;
  readonly onPress?: (() => void) | undefined;
};
