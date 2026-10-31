import { COVERED_CATALOG_OPACITY } from "./paneMotionSpec";

/**
 * One frame's settled pane arrangement, the target of a pane rearrangement. React resolves it
 * from the pane visibility; the UI thread turns it into pixels with the measured frame width.
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
  /** The catalog's sidebar width; `0` where no sidebar exists and the catalog spans the frame. */
  readonly sidebarWidth: number;
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
        detailWidth: frameWidth - sidebar,
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
      // A destination past the trailing edge keeps the width it has beside the catalog.
      return {
        catalogOpacity: 1,
        catalogWidth: frameWidth,
        detailWidth: frameWidth - sidebar,
        detailX: frameWidth,
      };
    case "under":
      break;
  }
  // The phone stack: the destination sits over a full-width catalog.
  return { catalogOpacity: 1, catalogWidth: frameWidth, detailWidth: frameWidth, detailX: 0 };
}

type RightPaneGeometry = Pick<PaneGeometry, "centerClipWidth" | "rightWidth" | "rightX">;

/** The center surface and the right pane inside the destination. */
function rightPaneGeometry(
  right: PaneArrangement["right"],
  detailX: number,
  detailWidth: number,
): RightPaneGeometry {
  "worklet";
  const share = detailWidth / CENTER_RIGHT_SHARES;
  switch (right) {
    case "beside":
      return {
        centerClipWidth: detailWidth - share,
        rightWidth: share,
        rightX: detailX + detailWidth - share,
      };
    case "cover":
      return { centerClipWidth: detailWidth, rightWidth: detailWidth, rightX: detailX };
    case "offscreen":
      break;
  }
  // Past the trailing edge at its beside width, so it slides back in without reflowing.
  return { centerClipWidth: detailWidth, rightWidth: share, rightX: detailX + detailWidth };
}

// Worklets capture helper values during module initialization, so dependencies must come first.
/** The settled geometry of `arrangement` in a frame `frameWidth` wide. */
export function paneGeometry(arrangement: PaneArrangement, frameWidth: number): PaneGeometry {
  "worklet";
  const sidebar = Math.min(Math.max(arrangement.sidebarWidth, 0), frameWidth);
  const left = leftPaneGeometry(arrangement.left, sidebar, frameWidth);
  const right = rightPaneGeometry(arrangement.right, left.detailX, left.detailWidth);
  // Settled, every pane shows its whole content box.
  return {
    catalogOpacity: left.catalogOpacity,
    catalogVisibleWidth: left.catalogWidth,
    catalogWidth: left.catalogWidth,
    centerClipWidth: right.centerClipWidth,
    centerLeftRadius: arrangement.centerLeftRadius,
    centerRightRadius: arrangement.centerRightRadius,
    centerWidth: right.centerClipWidth,
    detailVisibleWidth: left.detailWidth,
    detailWidth: left.detailWidth,
    detailX: left.detailX,
    rightVisibleWidth: right.rightWidth,
    rightWidth: right.rightWidth,
    rightX: right.rightX,
  };
}

function mix(from: number, to: number, progress: number): number {
  "worklet";
  return from + (to - from) * progress;
}

function mixWidth(from: number, to: number, progress: number): number {
  "worklet";
  return Math.max(0, mix(from, to, progress));
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
  return {
    catalogOpacity: Math.min(1, Math.max(0, mix(from.catalogOpacity, to.catalogOpacity, progress))),
    catalogVisibleWidth: mixWidth(from.catalogVisibleWidth, to.catalogVisibleWidth, progress),
    catalogWidth: Math.max(from.catalogWidth, to.catalogWidth),
    centerClipWidth: mixWidth(from.centerClipWidth, to.centerClipWidth, progress),
    centerLeftRadius: Math.max(0, mix(from.centerLeftRadius, to.centerLeftRadius, progress)),
    centerRightRadius: Math.max(0, mix(from.centerRightRadius, to.centerRightRadius, progress)),
    centerWidth: Math.max(from.centerWidth, to.centerWidth),
    detailVisibleWidth: mixWidth(from.detailVisibleWidth, to.detailVisibleWidth, progress),
    detailWidth: Math.max(from.detailWidth, to.detailWidth),
    detailX: mix(from.detailX, to.detailX, progress),
    rightVisibleWidth: mixWidth(from.rightVisibleWidth, to.rightVisibleWidth, progress),
    rightWidth: Math.max(from.rightWidth, to.rightWidth),
    rightX: mix(from.rightX, to.rightX, progress),
  };
}

/**
 * How far `box`'s content extends past the pane's visible trailing edge: the layout width it
 * holds while panes move minus the width it shows now; `0` once settled. Pane chrome gives up
 * this much of its trailing side, so it lays out to exactly the width the pane shows.
 */
export function paneChromeInset(pane: PaneGeometry, box: PaneBox): number {
  "worklet";
  switch (box) {
    case "catalog":
      return Math.max(0, pane.catalogWidth - pane.catalogVisibleWidth);
    case "center":
      return Math.max(0, pane.centerWidth - pane.centerClipWidth);
    case "destination":
      return Math.max(0, pane.detailWidth - pane.detailVisibleWidth);
    case "right":
      break;
  }
  return Math.max(0, pane.rightWidth - pane.rightVisibleWidth);
}
