import { useId, useLayoutEffect, type RefObject } from "react";
import { findNodeHandle, Platform, type Text, type View } from "react-native";
import { usePerformanceExperiment } from "../data/performance-experiments";
import { attachTextShimmer } from "../native/textShimmer";
import { useReducedMotionPreference } from "../rendering/reduced-motion-store";

/** Owns only the decoration lifetime; it creates no native view or layout box. */
export function TextShimmer({
  shimmering,
  target,
}: {
  readonly shimmering: boolean;
  readonly target: RefObject<Text | View | null>;
}): null {
  const token = useId();
  const reducedMotion = useReducedMotionPreference();
  const disabled = usePerformanceExperiment("disableTextShimmer");
  const enabled = Platform.OS === "android" && shimmering && !reducedMotion && !disabled;
  useLayoutEffect(() => {
    if (!enabled || target.current === null) {
      return undefined;
    }
    const tag = findNodeHandle(target.current);
    return tag === null ? undefined : attachTextShimmer(tag, token);
  }, [enabled, target, token]);
  return null;
}
