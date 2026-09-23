import type { ViewProps } from "react-native";

export const THREAD_ROW_TAP_MAX_DISTANCE = 8;
export const THREAD_ROW_LONG_PRESS_DURATION = 350;
export const THREAD_ROW_PRESSED_OPACITY = 0.68;

/** The link owns navigation; the row trigger only recognizes an intentional activation. */
export type ThreadRowLinkTriggerProps = ViewProps & {
  readonly onLongPress: () => void;
  readonly onPress?: () => void;
  readonly selected: boolean;
  readonly swipeEnabled: boolean;
};
