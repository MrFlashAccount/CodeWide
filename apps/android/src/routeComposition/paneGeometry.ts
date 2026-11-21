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
  readonly centerLeftRadius: number;
  readonly centerRightRadius: number;
  readonly left: "alone" | "beside" | "covered" | "under";
  readonly right: "beside" | "cover" | "offscreen";
  /** Whether the catalog keeps the sidebar width; without one it spans the frame. */
  readonly sidebar: boolean;
};

/**
 * Pane geometry in frame coordinates. Layout widths size each pane's content box and change at
 * most twice per rearrangement (they hold the larger of both ends while panes move); positions,
 * the center clip, radii, the catalog opacity and every visible width move every frame without
 * relayout of content. A visible width is the width the pane shows now; pane chrome (headers,
 * bottom bars) follows it, while the rest of the content keeps the layout width.
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
const CENTER_RIGHT_SHARES = 2;

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
/**
 * The settled geometry of `arrangement` in a frame `frameWidth` wide: exactly what Yoga lays out
 * at rest from the frame's relative pane styles, in pixels for a motion's ends.
 */
export function paneGeometry(arrangement: PaneArrangement, frameWidth: number): PaneGeometry {
  "worklet";
  const sidebar = arrangement.sidebar ? sidebarWidth(frameWidth) : 0;
  const left = leftPaneGeometry(arrangement.left, sidebar, frameWidth);
  // The two dividers partition the visible frame. A pane can keep its reading layout
  // under a neighbour or offscreen even when neither of its edges is visible.
  const detailVisibleWidth = Math.max(0, frameWidth - left.detailX);
  const beside = arrangement.right === "beside";
  const covered = arrangement.right === "cover";
  const share = left.detailWidth / CENTER_RIGHT_SHARES;
  const rightWidth = covered ? left.detailWidth : share;
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
 * The geometry `progress` of the way from `from` to `to`. Positions, clip, visible widths, radii
 * and opacity interpolate; layout widths hold the larger end so moving content is clipped, never
 * reflowed or exposed. Every pane derives its frame from this one function of one progress.
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
    catalogWidth: Math.max(from.catalogWidth, to.catalogWidth),
    centerClipWidth: mix(from.centerClipWidth, to.centerClipWidth, fraction),
    centerLeftRadius: mix(from.centerLeftRadius, to.centerLeftRadius, fraction),
    centerRightRadius: mix(from.centerRightRadius, to.centerRightRadius, fraction),
    centerWidth: Math.max(from.centerWidth, to.centerWidth),
    detailVisibleWidth: mix(from.detailVisibleWidth, to.detailVisibleWidth, fraction),
    detailWidth: Math.max(from.detailWidth, to.detailWidth),
    detailX: mix(from.detailX, to.detailX, fraction),
    rightVisibleWidth: mix(from.rightVisibleWidth, to.rightVisibleWidth, fraction),
    rightWidth: Math.max(from.rightWidth, to.rightWidth),
    rightX: mix(from.rightX, to.rightX, fraction),
  };
}

/** Width allocated to the mounted content even when the pane is covered or offscreen. */
function paneLayoutWidth(pane: PaneGeometry, box: PaneBox): number {
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

/** Signed trailing inset that lays the body out at its target width inside the moving viewport. */
export function snapshotBodyMargin(
  current: PaneGeometry,
  target: PaneGeometry,
  box: PaneBox,
): number {
  "worklet";
  return paneVisibleWidth(current, box) - paneLayoutWidth(target, box);
}
