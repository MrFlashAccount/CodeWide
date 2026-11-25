/** Bounds for the two visible neighbours in a wide workspace. */
export const MIN_PANE_PERCENT = 30;
export const HALF_PERCENT = 50;
export const FULL_PERCENT = 100;
export const MAX_DETAIL_PERCENT = FULL_PERCENT - MIN_PANE_PERCENT;
export const MIN_PANE_SHARE = MIN_PANE_PERCENT / FULL_PERCENT;

/** The pair that owns a divider and its last settled share. */
export type PanePair = "left+center" | "center+right";

/** Largest open leading pane in this pair. */
export function maximumPanePercent(pair: PanePair): number {
  "worklet";
  return pair === "left+center" ? HALF_PERCENT : MAX_DETAIL_PERCENT;
}

/** Yoga requires a numeric percentage literal for relative dimensions. */
export function yogaPercent(value: number): `${number}%` {
  "worklet";
  // WHY: RN requires a numeric template literal. String(value) widens it to an arbitrary string.
  // oxlint-disable-next-line typescript/restrict-template-expressions
  return `${value}%`;
}
