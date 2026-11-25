import {
  FULL_PERCENT,
  maximumPanePercent,
  MIN_PANE_PERCENT,
  MIN_PANE_SHARE,
  type PanePair,
} from "../ui/paneSplitSizes";
import type { PaneGeometry } from "./paneGeometry";

export type CoveredEdge = "leading" | "trailing" | "none";
const HALF = 0.5;
const HEIGHT_BANDS = 3;
/** The centered third of the workspace that accepts divider touches. */
export const DIVIDER_HIT_SHARE = 1 / HEIGHT_BANDS;
export const DETENT_DP = 10;
export const REOPEN_SLOP_DP = 12;

function coverThreshold(minimum: number): number {
  "worklet";
  return minimum * HALF;
}

function isCovered(remaining: number, minimum: number, latched: boolean): boolean {
  "worklet";
  const threshold = coverThreshold(minimum);
  return remaining <= threshold || (latched && remaining < threshold + REOPEN_SLOP_DP);
}

function visibleWidth(remaining: number, minimum: number): number {
  "worklet";
  if (remaining >= minimum) {
    return remaining;
  }
  const beyond = minimum - remaining - DETENT_DP;
  return beyond <= 0 ? minimum : remaining + DETENT_DP * Math.exp(-beyond / DETENT_DP);
}

/** Captured divider position, including its reversible detent on each coverable edge. */
export function dividerPosition(
  pair: PanePair,
  width: number,
  pointer: { readonly locked: CoveredEdge; readonly raw: number },
): { readonly edge: number; readonly locked: CoveredEdge } {
  "worklet";
  const { locked, raw } = pointer;
  const min = width * MIN_PANE_SHARE;
  if (isCovered(raw, min, locked === "leading")) {
    return { edge: 0, locked: "leading" };
  }
  if (pair === "left+center") {
    return { edge: Math.min(width * HALF, visibleWidth(raw, min)), locked: "none" };
  }
  const tail = width - raw;
  if (isCovered(tail, min, locked === "trailing")) {
    return { edge: width, locked: "trailing" };
  }
  return {
    edge: raw <= tail ? visibleWidth(raw, min) : width - visibleWidth(tail, min),
    locked: "none",
  };
}

/** The last open size; fullscreen is separate from a visible share. */
export function settledDividerPercent(pair: PanePair, edge: number, width: number): number {
  "worklet";
  const percent = (edge / width) * FULL_PERCENT;
  return Math.max(MIN_PANE_PERCENT, Math.min(maximumPanePercent(pair), percent));
}

/** Reveals the theme scrim over the finger-controlled part of the cover, up to the snap point. */
export function paneScrimProgress(visible: number, width: number): number {
  "worklet";
  const minimum = width * MIN_PANE_SHARE;
  if (width <= 0 || visible >= minimum) {
    return 0;
  }
  const snap = coverThreshold(minimum);
  const remaining = Math.max(0, (visible - snap) / (minimum - snap));
  return 1 - remaining * remaining;
}

/** Reading surfaces stay anchored at their minimum as the growing neighbour covers them. */
export function previewDivider(
  pair: PanePair,
  bounds: { readonly edge: number; readonly width: number },
  rest: PaneGeometry,
): PaneGeometry {
  "worklet";
  const { edge, width } = bounds;
  const min = width * MIN_PANE_SHARE;
  const tail = width - edge;
  if (pair === "left+center") {
    return {
      ...rest,
      catalogOpacity: 1,
      catalogVisibleWidth: edge,
      catalogWidth: Math.max(edge, min),
      centerClipWidth: tail,
      centerWidth: tail,
      detailVisibleWidth: tail,
      detailWidth: tail,
      detailX: edge,
      rightVisibleWidth: 0,
      rightX: width,
    };
  }
  return {
    ...rest,
    catalogOpacity: 0,
    catalogVisibleWidth: 0,
    centerClipWidth: edge,
    centerWidth: Math.max(edge, min),
    detailVisibleWidth: width,
    detailWidth: width,
    detailX: 0,
    rightVisibleWidth: tail,
    rightWidth: Math.max(tail, min),
    rightX: Math.min(edge, width - min),
  };
}
