import type { ViewProps } from "react-native";

export {
  ROW_ACTION_TAP_MAX_DISTANCE as THREAD_ROW_TAP_MAX_DISTANCE,
  ROW_ACTION_LONG_PRESS_DURATION as THREAD_ROW_LONG_PRESS_DURATION,
  ROW_ACTION_PRESSED_OPACITY as THREAD_ROW_PRESSED_OPACITY,
} from "../../ui/RowActionTrigger.types";

/** The link owns navigation; the row trigger only recognizes an intentional activation. */
export type ThreadRowLinkTriggerProps = ViewProps & {
  readonly onLongPress: () => void;
  readonly onPress?: () => void;
  readonly selected: boolean;
  readonly swipeEnabled: boolean;
};
