import { paneChromeInset, type PaneBox } from "./paneGeometry";
import { movingPaneGeometry, type PaneMotionState } from "./paneMotion";
import {
  REST_CENTER_CONTENT_FRAME,
  restCatalogFrame,
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
 * explicit pixels, in the same shape, so settling hands the box back to Yoga.
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
    left: 0,
    position: "absolute",
    transform: [{ translateX: pane.detailX }],
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
    width: pane.centerClipWidth,
  };
}

/** The center content box: the clip's width at rest, the larger end while panes move. */
export function centerContentFrame(state: PaneMotionState): CenterContentFrame {
  "worklet";
  return state.moving.get()
    ? { width: movingPaneGeometry(state).centerWidth }
    : REST_CENTER_CONTENT_FRAME;
}

/** The right pane box, relative to its destination. */
export function rightFrame(state: PaneMotionState): RightFrame {
  "worklet";
  if (!state.moving.get()) {
    return restRightFrame(state.arrangement.get());
  }
  const pane = movingPaneGeometry(state);
  return {
    left: 0,
    transform: [{ translateX: pane.rightX - pane.detailX }],
    width: pane.rightWidth,
  };
}

/** How far `box`'s content extends past its visible edge now; `0` at rest. */
export function currentChromeInset(state: PaneMotionState, box: PaneBox): number {
  "worklet";
  return state.moving.get() ? paneChromeInset(movingPaneGeometry(state), box) : 0;
}
