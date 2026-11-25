import { paneChromeInset, paneGeometry, type PaneBox } from "./paneGeometry";
import { movingPaneGeometry, type PaneMotionState } from "./paneMotion";
import {
  REST_CENTER_CONTENT_FRAME,
  restCatalogFrame,
  restChromeInset,
  restCenterClipFrame,
  restDestinationFrame,
  restRightFrame,
  type CatalogFrame,
  type CenterClipFrame,
  type CenterContentFrame,
  type DestinationFrame,
  type RightFrame,
} from "./paneRestFrames";

/*
 * Each pane box's animated style. At rest it is the relative Yoga frame of the settled
 * arrangement (`paneRestFrames.ts`); only while the frame's one progress moves does it carry
 * explicit pixels. Positions stay in Yoga throughout: a render transform and its replacement
 * layout offset must never be visible together during the final native layout.
 */

/** The catalog box. */
export function catalogFrame(state: PaneMotionState): CatalogFrame {
  "worklet";
  if (!state.moving.get()) {
    return restCatalogFrame(state.arrangement.get());
  }
  const pane = movingPaneGeometry(state);
  return {
    maxWidth: pane.catalogWidth,
    minWidth: pane.catalogWidth,
    opacity: pane.catalogOpacity,
    width: pane.catalogWidth,
  };
}

/** The destination box: in the row beside the catalog at rest, absolute while it moves. */
export function destinationFrame(state: PaneMotionState): DestinationFrame {
  "worklet";
  if (!state.moving.get()) {
    return restDestinationFrame(state.arrangement.get());
  }
  const pane = movingPaneGeometry(state);
  return {
    borderBottomLeftRadius: pane.centerLeftRadius,
    borderTopLeftRadius: pane.centerLeftRadius,
    flexGrow: 0,
    left: pane.detailX,
    minWidth: 0,
    position: "absolute",
    width: pane.detailWidth,
  };
}

/** The center surface, which clips the center content. */
export function centerClipFrame(state: PaneMotionState): CenterClipFrame {
  "worklet";
  if (!state.moving.get()) {
    return restCenterClipFrame(state.arrangement.get());
  }
  const pane = movingPaneGeometry(state);
  return {
    borderBottomRightRadius: pane.centerRightRadius,
    borderTopRightRadius: pane.centerRightRadius,
    // A single visible center fills its destination in the same Yoga pass. An independent
    // animated pixel width here can land a frame later than its moving parent.
    width: pane.centerClipWidth === pane.detailWidth ? "100%" : pane.centerClipWidth,
  };
}

/** The center content box: the clip's width at rest, its current layout width while panes move. */
export function centerContentFrame(state: PaneMotionState): CenterContentFrame {
  "worklet";
  if (state.moving.get()) {
    const pane = movingPaneGeometry(state);
    if (pane.centerWidth > pane.centerClipWidth) {
      return { width: pane.centerWidth };
    }
  }
  return REST_CENTER_CONTENT_FRAME;
}

/** The right pane box, relative to its destination. */
export function rightFrame(state: PaneMotionState): RightFrame {
  "worklet";
  if (!state.moving.get()) {
    return restRightFrame(state.arrangement.get());
  }
  const pane = movingPaneGeometry(state);
  return {
    left: pane.rightX - pane.detailX,
    width: pane.rightWidth,
  };
}

/** Trailing space outside the visible pane. At rest Yoga resolves a fully covered edge. */
export function currentChromeInset(state: PaneMotionState, box: PaneBox): number | "100%" {
  "worklet";
  const drag = state.drag.get();
  if (drag !== null) {
    // Below the minimum the pane and its chrome stay in place under the covering neighbour.
    return 0;
  }
  return state.moving.get()
    ? paneChromeInset(movingPaneGeometry(state), box)
    : restChromeInset(state.arrangement.get(), box);
}

/** Caps descendants while a native screen still reports a wider size after a shrinking motion. */
export function landedViewportMaxWidth(
  state: PaneMotionState,
  frameWidth: number,
  screenWidth: number,
): number | "100%" {
  "worklet";
  // Folding or rotating invalidates the measured motion. Yoga owns the new frame immediately.
  const motionWidth = state.frameWidth.get();
  if (frameWidth <= 0 || Math.abs(frameWidth - motionWidth) > 1) {
    return "100%";
  }
  const target = paneGeometry(state.arrangement.get(), motionWidth).detailWidth;
  // Android reports the screen on the physical pixel grid, while the split can be fractional.
  return target < state.from.get().detailWidth && screenWidth - target > 1 ? target : "100%";
}
