import { COVERED_CATALOG_OPACITY } from "./paneMotionSpec";

import { sidebarWidth } from "../ui/sidebarDimensions";

/**
 * One frame's settled pane arrangement, the target of a pane rearrangement. React resolves it
 * from the pane visibility. At rest Yoga lays it out (`paneFrames.ts`); while panes move the UI
 * thread turns it into pixels with the frame width measured when the motion starts.
 *
 * - `left`: `beside` keeps the catalog at its sidebar width; `covered` slides the destination
 *   over it and dims it; `alone` shows the catalog over the whole frame and moves the destination
 *   past the trailing edge; `under` is the phone stack, where the destination sits over a
 *   full-width catalog.
 * - `right`: `beside` splits the destination equally between center and right; `cover` lays the
 *   right pane over the retained center; `offscreen` keeps it past the trailing edge.
 *
 * The frame resolves `right: "beside"` only with `left: "covered"` (`resolvePaneArrangement`), so
 * the destination spans the frame and center and right split its whole width.
 */
export type PaneArrangement = {
  readonly catalogPercent?: number | null;
  readonly centerLeftRadius: number;
  readonly centerPercent?: number;
  readonly centerRightRadius: number;
  readonly left: "alone" | "beside" | "covered" | "under";
  readonly right: "beside" | "cover" | "offscreen";
  /** Whether the catalog keeps the sidebar width; without one it spans the frame. */
  readonly sidebar: boolean;
};

/**
 * Layout and visible bounds in frame coordinates. They coincide for an open split. A pane
 * covered by its neighbour or parked offscreen can retain a wider layout than its visible area.
 */
export type PaneGeometry = {
  readonly catalogOpacity: number;
  /** Visible width of the catalog. */
  readonly catalogVisibleWidth: number;
  /** Layout width of the catalog content. */
  readonly catalogWidth: number;
  /** Visible width of the center surface; it clips center content of `centerWidth`. */
  readonly centerClipWidth: number;
  readonly centerLeftRadius: number;
  readonly centerRightRadius: number;
  /** Layout width of the center content. */
  readonly centerWidth: number;
  /** Visible width of the destination. */
  readonly detailVisibleWidth: number;
  /** Layout width of the destination. */
  readonly detailWidth: number;
  /** Leading edge of the destination. */
  readonly detailX: number;
  /** Visible width of the right pane. */
  readonly rightVisibleWidth: number;
  /** Layout width of the right pane. */
  readonly rightWidth: number;
  /** Leading edge of the right pane. */
  readonly rightX: number;
};

/**
 * The pane boxes of one frame: the catalog, the destination the frame places beside it, and the
 * center and right panes a destination splits itself into.
 */
export type PaneBox = "catalog" | "center" | "destination" | "right";

/** Center and right split the destination into this many equal shares. */
const DEFAULT_CENTER_PERCENT = 50;
const FULL_PERCENT = 100;

type LeftPaneGeometry = Pick<
  PaneGeometry,
  "catalogOpacity" | "catalogWidth" | "detailWidth" | "detailX"
>;

/** The catalog and the destination's placement beside, over or past it. */
function leftPaneGeometry(
  left: PaneArrangement["left"],
  sidebar: number,
  frameWidth: number,
): LeftPaneGeometry {
  "worklet";
  switch (left) {
    case "beside":
      return {
        catalogOpacity: 1,
        catalogWidth: sidebar,
        detailWidth: Math.max(0, frameWidth - sidebar),
        detailX: sidebar,
      };
    case "covered":
      // The covered catalog keeps its sidebar width; without a sidebar it spans the frame.
      return {
        catalogOpacity: COVERED_CATALOG_OPACITY,
        catalogWidth: sidebar > 0 ? sidebar : frameWidth,
        detailWidth: frameWidth,
        detailX: 0,
      };
    case "alone":
      // Past the trailing edge the destination spans the frame, as Yoga can lay it out at rest.
      return {
        catalogOpacity: 1,
        catalogWidth: frameWidth,
        detailWidth: frameWidth,
        detailX: frameWidth,
      };
    case "under":
      break;
  }
  // The phone stack: the destination sits over a full-width catalog.
  return { catalogOpacity: 1, catalogWidth: frameWidth, detailWidth: frameWidth, detailX: 0 };
}

// Worklets capture helper values during module initialization, so dependencies must come first.
function catalogLayoutWidth(
  { catalogPercent = null, sidebar }: PaneArrangement,
  frameWidth: number,
): number {
  "worklet";
  if (!sidebar) {
    return 0;
  }
  return catalogPercent === null
    ? sidebarWidth(frameWidth)
    : (frameWidth * catalogPercent) / FULL_PERCENT;
}

/**
 * The settled geometry of `arrangement` in a frame `frameWidth` wide: exactly what Yoga lays out
 * at rest from the frame's relative pane styles, in pixels for a motion's ends.
 */
export function paneGeometry(arrangement: PaneArrangement, frameWidth: number): PaneGeometry {
  "worklet";
  const left = leftPaneGeometry(
    arrangement.left,
    catalogLayoutWidth(arrangement, frameWidth),
    frameWidth,
  );
  // The two dividers partition the visible frame. A pane can keep its reading layout
  // under a neighbour or offscreen even when neither of its edges is visible.
  const detailVisibleWidth = Math.max(0, frameWidth - left.detailX);
  const beside = arrangement.right === "beside";
  const covered = arrangement.right === "cover";
  const share =
    (left.detailWidth * (arrangement.centerPercent ?? DEFAULT_CENTER_PERCENT)) / FULL_PERCENT;
  const rightWidth = covered ? left.detailWidth : left.detailWidth - share;
  const rightVisibleWidth =
    arrangement.right === "offscreen" ? 0 : Math.min(detailVisibleWidth, rightWidth);
  const centerClipWidth = detailVisibleWidth - rightVisibleWidth;
  return {
    catalogOpacity: left.catalogOpacity,
    catalogVisibleWidth: Math.min(left.detailX, frameWidth),
    catalogWidth: left.catalogWidth,
    centerClipWidth,
    centerLeftRadius: arrangement.centerLeftRadius,
    centerRightRadius: arrangement.centerRightRadius,
    centerWidth: beside || (covered && arrangement.sidebar) ? share : left.detailWidth,
    detailVisibleWidth,
    detailWidth: left.detailWidth,
    detailX: left.detailX,
    rightVisibleWidth,
    rightWidth,
    rightX: left.detailX + centerClipWidth,
  };
}

function mix(from: number, to: number, progress: number): number {
  "worklet";
  return from + (to - from) * progress;
}

/**
 * Every box follows the same spring from its actual starting bounds to its destination.
 */
export function interpolatePaneGeometry(
  from: PaneGeometry,
  to: PaneGeometry,
  progress: number,
): PaneGeometry {
  "worklet";
  // A spring can overshoot; two adjoining panes must still share one on-screen edge.
  const fraction = Math.max(0, Math.min(1, progress));
  return {
    catalogOpacity: mix(from.catalogOpacity, to.catalogOpacity, fraction),
    catalogVisibleWidth: mix(from.catalogVisibleWidth, to.catalogVisibleWidth, fraction),
    catalogWidth: mix(from.catalogWidth, to.catalogWidth, fraction),
    centerClipWidth: mix(from.centerClipWidth, to.centerClipWidth, fraction),
    centerLeftRadius: mix(from.centerLeftRadius, to.centerLeftRadius, fraction),
    centerRightRadius: mix(from.centerRightRadius, to.centerRightRadius, fraction),
    centerWidth: mix(from.centerWidth, to.centerWidth, fraction),
    detailVisibleWidth: mix(from.detailVisibleWidth, to.detailVisibleWidth, fraction),
    detailWidth: mix(from.detailWidth, to.detailWidth, fraction),
    detailX: mix(from.detailX, to.detailX, fraction),
    rightVisibleWidth: mix(from.rightVisibleWidth, to.rightVisibleWidth, fraction),
    rightWidth: mix(from.rightWidth, to.rightWidth, fraction),
    rightX: mix(from.rightX, to.rightX, fraction),
  };
}

/** Width allocated to the mounted content even when the pane is covered or offscreen. */
export function paneLayoutWidth(pane: PaneGeometry, box: PaneBox): number {
  "worklet";
  switch (box) {
    case "catalog":
      return pane.catalogWidth;
    case "center":
      return pane.centerWidth;
    case "destination":
      return pane.detailWidth;
    case "right":
      break;
  }
  return pane.rightWidth;
}

/** Width of the part of one pane that is being revealed by the frame. */
function paneVisibleWidth(pane: PaneGeometry, box: PaneBox): number {
  "worklet";
  switch (box) {
    case "catalog":
      return pane.catalogVisibleWidth;
    case "center":
      return pane.centerClipWidth;
    case "destination":
      return pane.detailVisibleWidth;
    case "right":
      break;
  }
  return pane.rightVisibleWidth;
}

/** How much of the retained layout lies beyond the moving pane edge. */
export function paneChromeInset(pane: PaneGeometry, box: PaneBox): number {
  "worklet";
  return Math.max(0, paneLayoutWidth(pane, box) - paneVisibleWidth(pane, box));
}
