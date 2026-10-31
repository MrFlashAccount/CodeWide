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
 * the center clip, radii and the catalog opacity move every frame without relayout of content.
 */
export type PaneGeometry = {
  readonly catalogOpacity: number;
  /** Layout width of the catalog content. */
  readonly catalogWidth: number;
  /** Visible width of the center surface; it clips center content of `centerWidth`. */
  readonly centerClipWidth: number;
  readonly centerLeftRadius: number;
  readonly centerRightRadius: number;
  /** Layout width of the center content. */
  readonly centerWidth: number;
  /** Layout width of the destination. */
  readonly detailWidth: number;
  /** Leading edge of the destination. */
  readonly detailX: number;
  /** Layout width of the right pane. */
  readonly rightWidth: number;
  /** Leading edge of the right pane. */
  readonly rightX: number;
};

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
  return {
    catalogOpacity: left.catalogOpacity,
    catalogWidth: left.catalogWidth,
    centerClipWidth: right.centerClipWidth,
    centerLeftRadius: arrangement.centerLeftRadius,
    centerRightRadius: arrangement.centerRightRadius,
    centerWidth: right.centerClipWidth,
    detailWidth: left.detailWidth,
    detailX: left.detailX,
    rightWidth: right.rightWidth,
    rightX: right.rightX,
  };
}

function mix(from: number, to: number, progress: number): number {
  "worklet";
  return from + (to - from) * progress;
}

/**
 * The geometry `progress` of the way from `from` to `to`. Positions, clip, radii and opacity
 * interpolate; layout widths hold the larger end so moving content is clipped, never reflowed
 * or exposed. Every pane derives its frame from this one function of one progress.
 */
export function interpolatePaneGeometry(
  from: PaneGeometry,
  to: PaneGeometry,
  progress: number,
): PaneGeometry {
  "worklet";
  return {
    catalogOpacity: Math.min(1, Math.max(0, mix(from.catalogOpacity, to.catalogOpacity, progress))),
    catalogWidth: Math.max(from.catalogWidth, to.catalogWidth),
    centerClipWidth: Math.max(0, mix(from.centerClipWidth, to.centerClipWidth, progress)),
    centerLeftRadius: Math.max(0, mix(from.centerLeftRadius, to.centerLeftRadius, progress)),
    centerRightRadius: Math.max(0, mix(from.centerRightRadius, to.centerRightRadius, progress)),
    centerWidth: Math.max(from.centerWidth, to.centerWidth),
    detailWidth: Math.max(from.detailWidth, to.detailWidth),
    detailX: mix(from.detailX, to.detailX, progress),
    rightWidth: Math.max(from.rightWidth, to.rightWidth),
    rightX: mix(from.rightX, to.rightX, progress),
  };
}
