import { withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { PILL_SPRING } from "./const";
import type { IMaskedTabBoxEntry } from "./types";

type PillMotionValue = { value: number };
type PillSelectionTarget = Pick<IMaskedTabBoxEntry, "value" | "width" | "x">;

/** Starts visual selection on the UI runtime before notifying the controlled React owner. */
export function startPillSelectionOnUI(
  target: PillSelectionTarget,
  pillX: PillMotionValue,
  pillWidth: PillMotionValue,
  selectValue: (value: string) => void,
): void {
  "worklet";
  pillX.value = withSpring(target.x, PILL_SPRING);
  pillWidth.value = withSpring(target.width, PILL_SPRING);
  scheduleOnRN(selectValue, target.value);
}
