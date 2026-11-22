import type { DimensionValue } from "react-native";

import { V1_TWO_PANE_MIN_WIDTH } from "../native/window-layout";
import {
  sidebarWidth,
  SIDEBAR_FRAME_SHARE,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "../ui/sidebarDimensions";
import type { PaneArrangement, PaneBox } from "./paneGeometry";
import { COVERED_CATALOG_OPACITY } from "./paneMotionSpec";

/**
 * The style of each pane box, in the order the frame lays them out. At rest every value is
 * relative (percentages, flex, constant bounds and the arrangement's own radii and opacity), so
 * Yoga owns the settled layout and absorbs any frame size change without a JavaScript event.
 * Only while a rearrangement moves do the boxes take explicit pixels (`paneFrames.ts`); when it
 * settles they return to these relative values, which Yoga resolves to the motion's explicit end
 * (`paneGeometry`). Each frame keeps one shape in both states, so the animated style always owns
 * the same keys.
 */
export type CatalogFrame = {
  readonly maxWidth: DimensionValue;
  readonly minWidth: DimensionValue;
  readonly opacity: number;
  readonly width: DimensionValue;
};

/** The destination flows beside the catalog at rest; otherwise it lies absolutely over the frame. */
export type DestinationFrame = {
  readonly borderBottomLeftRadius: number;
  readonly borderTopLeftRadius: number;
  readonly flexGrow: number;
  readonly left: DimensionValue;
  readonly minWidth: number;
  readonly position: "absolute" | "relative";
  readonly width: DimensionValue;
};

/** The center surface clips its content box; both sit at the destination's leading edge. */
export type CenterClipFrame = {
  readonly borderBottomRightRadius: number;
  readonly borderTopRightRadius: number;
  readonly width: DimensionValue;
};

export type CenterContentFrame = { readonly width: DimensionValue };

/** The right pane, positioned relative to the destination that holds it. */
export type RightFrame = {
  readonly left: DimensionValue;
  readonly width: DimensionValue;
};

const FULL = "100%";
const HALF = "50%";
// Keep the reading surface viable while the UI thread still places it beside the catalog
// in a window that has already folded. Clear the bound in the same style that stacks it.
const MIN_BESIDE_WIDTH = V1_TWO_PANE_MIN_WIDTH - sidebarWidth(V1_TWO_PANE_MIN_WIDTH);

/** The visible tablet chrome stays collapsed while its reading layout is parked offscreen. */
export function restChromeInset(arrangement: PaneArrangement, box: PaneBox): 0 | "100%" {
  "worklet";
  if (!arrangement.sidebar) {
    return 0;
  }
  if (box === "catalog") {
    return arrangement.left === "covered" ? FULL : 0;
  }
  if (arrangement.left === "alone") {
    return FULL;
  }
  switch (box) {
    case "center":
      return arrangement.right === "cover" ? FULL : 0;
    case "right":
      return arrangement.right === "offscreen" ? FULL : 0;
    case "destination":
      break;
  }
  return 0;
}

/** The catalog, first in the frame's row: at its relative sidebar width or across the frame. */
export function restCatalogFrame(arrangement: PaneArrangement): CatalogFrame {
  "worklet";
  const opacity = arrangement.left === "covered" ? COVERED_CATALOG_OPACITY : 1;
  const keepsSidebar =
    arrangement.sidebar && (arrangement.left === "beside" || arrangement.left === "covered");
  return keepsSidebar
    ? {
        maxWidth: SIDEBAR_MAX_WIDTH,
        minWidth: SIDEBAR_MIN_WIDTH,
        opacity,
        width: SIDEBAR_FRAME_SHARE,
      }
    : { maxWidth: FULL, minWidth: 0, opacity, width: FULL };
}

/** Beside the catalog the destination takes the rest of the row; otherwise it lies over it. */
export function restDestinationFrame(arrangement: PaneArrangement): DestinationFrame {
  "worklet";
  const radius = arrangement.centerLeftRadius;
  switch (arrangement.left) {
    case "beside":
      return {
        borderBottomLeftRadius: radius,
        borderTopLeftRadius: radius,
        flexGrow: 1,
        left: 0,
        minWidth: MIN_BESIDE_WIDTH,
        position: "relative",
        width: "auto",
      };
    case "alone":
      // Past the trailing edge at the frame width.
      return {
        borderBottomLeftRadius: radius,
        borderTopLeftRadius: radius,
        flexGrow: 0,
        left: FULL,
        minWidth: 0,
        position: "absolute",
        width: FULL,
      };
    case "covered":
    case "under":
      break;
  }
  return {
    borderBottomLeftRadius: radius,
    borderTopLeftRadius: radius,
    flexGrow: 0,
    left: 0,
    minWidth: 0,
    position: "absolute",
    width: FULL,
  };
}

/** The covered tablet center keeps its split reading width beneath the opaque right pane. */
export function restCenterClipFrame(arrangement: PaneArrangement): CenterClipFrame {
  "worklet";
  return {
    borderBottomRightRadius: arrangement.centerRightRadius,
    borderTopRightRadius: arrangement.centerRightRadius,
    width:
      arrangement.right === "beside" || (arrangement.right === "cover" && arrangement.sidebar)
        ? HALF
        : FULL,
  };
}

/** At rest the center content fills its clip. */
export const REST_CENTER_CONTENT_FRAME: CenterContentFrame = { width: FULL };

/** The right pane beside the center, over it, or past the trailing edge at its beside width. */
export function restRightFrame(arrangement: PaneArrangement): RightFrame {
  "worklet";
  switch (arrangement.right) {
    case "beside":
      return { left: arrangement.left === "alone" ? 0 : HALF, width: HALF };
    case "cover":
      return { left: 0, width: FULL };
    case "offscreen":
      break;
  }
  return { left: arrangement.left === "alone" ? 0 : FULL, width: HALF };
}
