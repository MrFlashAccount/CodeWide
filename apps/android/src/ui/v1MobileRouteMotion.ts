// WHY: These values are the public motion contract mirrored by the Android native-stack XML resources.
// oxlint-disable-next-line eslint/no-magic-numbers
const BACKGROUND_TRAVEL = { percent: 2, ratio: 0.02 } as const;
// WHY: Android fast_out_slow_in is the established V1 route interpolator and must match in-sheet navigation exactly.
// oxlint-disable-next-line eslint/no-magic-numbers
const EASING_BEZIER = [0.4, 0, 0.2, 1] as const;
// WHY: These values are the public motion contract mirrored by the Android native-stack XML resources.
// oxlint-disable-next-line eslint/no-magic-numbers
const FOREGROUND_TRAVEL = { percent: 4, positivePercent: "4%", ratio: 0.04 } as const;
const ROUTE_TRANSITION_DURATION_MS = 250;

/** Motion contract shared by the V1 native route stack and local navigation inside sheets. */
export const v1MobileRouteMotion = {
  backgroundTravel: BACKGROUND_TRAVEL,
  durationMs: ROUTE_TRANSITION_DURATION_MS,
  easingBezier: EASING_BEZIER,
  foregroundTravel: FOREGROUND_TRAVEL,
} as const;
