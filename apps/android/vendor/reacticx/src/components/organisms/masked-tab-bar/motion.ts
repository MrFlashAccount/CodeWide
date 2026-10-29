import { withSpring } from "react-native-reanimated";

import { PILL_SPRING } from "./const";
import type { IMaskedTabBoxEntry } from "./types";

type PillMotionValue = { value: number };
type PillSelectionTarget = Pick<IMaskedTabBoxEntry, "value" | "width" | "x">;

/** Starts visual selection feedback on the UI runtime before gesture settlement. */
export function startPillMotionOnUI(
  target: PillSelectionTarget,
  pillX: PillMotionValue,
  pillWidth: PillMotionValue,
): void {
  "worklet";
  pillX.value = withSpring(target.x, PILL_SPRING);
  pillWidth.value = withSpring(target.width, PILL_SPRING);
}
