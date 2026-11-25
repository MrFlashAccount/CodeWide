import { selectionAsync } from "expo-haptics";
import { PixelRatio } from "react-native";
import {
  Gesture,
  type GestureTouchEvent,
  type GestureStateManager,
} from "react-native-gesture-handler";
import {
  cancelAnimation,
  measure,
  useAnimatedReaction,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { FULL_PERCENT, MIN_PANE_SHARE, type PanePair } from "../ui/paneSplitSizes";
import { paneGeometry } from "./paneGeometry";
import {
  dividerPosition,
  DETENT_DP,
  DIVIDER_HIT_SHARE,
  REOPEN_SLOP_DP,
  previewDivider,
  settledDividerPercent,
  type CoveredEdge,
} from "./paneDividerGeometry";
import { PANE_SPRING } from "./paneMotionSpec";
import { useReducedMotionPreference } from "../rendering/reduced-motion-store";
import { touchTarget } from "../theme";
import {
  movingPaneGeometry,
  startPaneMotion,
  type PaneMotionRequest,
  type PaneMotionState,
} from "./paneMotion";

export type DividerLanding =
  | { readonly kind: "split"; readonly percent: number }
  | { readonly kind: "covered"; readonly side: "leading" | "trailing" };

function landingAt(
  pair: PanePair,
  width: number,
  position: { readonly edge: number; readonly side: CoveredEdge },
): DividerLanding {
  "worklet";
  return position.side === "none"
    ? { kind: "split", percent: settledDividerPercent(pair, position.edge, width) }
    : { kind: "covered", side: position.side };
}

function tick(): void {
  void selectionAsync().catch(() => undefined);
}

/** A completed touch can lay out chat rows before JS receives the preset press. */
export function preparePresetTranscript(
  state: PaneMotionState,
  pair: PanePair,
  percent: number,
): void {
  "worklet";
  const width = measure(state.frameRef)?.width ?? 0;
  if (width > 0) {
    state.landing.set(
      previewDivider(
        pair,
        { edge: (width * percent) / FULL_PERCENT, width },
        paneGeometry(state.arrangement.get(), width),
      ),
    );
  }
}

/** Open splits already have both panes mounted. Their button can start the actual motion immediately. */
export function startPresetMotion(
  state: PaneMotionState,
  { pair, percent }: { readonly pair: PanePair; readonly percent: number },
  completion: Pick<PaneMotionRequest, "generation" | "onSettled">,
): void {
  "worklet";
  const current = state.arrangement.get();
  const next =
    pair === "left+center"
      ? { ...current, catalogPercent: percent }
      : { ...current, centerPercent: percent };
  startPaneMotion(state, { animate: true, ...completion, next });
}

/** Cancels direct manipulation and hands geometry back to the currently committed arrangement. */
export function cancelDividerDrag(state: PaneMotionState): void {
  "worklet";
  if (state.drag.get() === null) {
    return;
  }
  state.drag.set(null);
  state.landing.set(null);
  state.moving.set(false);
  state.progress.set(1);
}

const HALF = 0.5;
/** Current on-screen grip center, shared by visual placement and touch recognition. */
export function dividerAnchor(state: PaneMotionState, pair: PanePair, settled: number): number {
  "worklet";
  if (!state.moving.get()) {
    return settled;
  }
  const frame = movingPaneGeometry(state);
  const x =
    pair === "left+center" ? frame.catalogVisibleWidth : frame.detailX + frame.centerClipWidth;
  return Math.max(touchTarget, Math.min(state.frameWidth.get() - touchTarget, x));
}

const PAN_SLOP = 6;
const TAP_SLOP = 8;
function startSnap(offset: SharedValue<number>, distance: number, reducedMotion: boolean): void {
  "worklet";
  cancelAnimation(offset);
  offset.set(reducedMotion ? 0 : distance);
  if (!reducedMotion) {
    offset.set(withSpring(0, PANE_SPRING));
  }
}

function handOffOpenSplit(
  landing: DividerLanding,
  target: number,
  drag: { readonly edge: number; readonly origin: number },
): boolean {
  "worklet";
  return (
    landing.kind === "split" &&
    Math.abs(drag.origin - target) > 1 &&
    Math.abs(target - drag.edge) <= 1
  );
}

function detentHaptic(remaining: number, minimum: number, buzzed: SharedValue<boolean>): void {
  "worklet";
  if (remaining >= minimum + REOPEN_SLOP_DP) {
    buzzed.set(false);
  }
  if (remaining < minimum - DETENT_DP && !buzzed.get()) {
    buzzed.set(true);
    scheduleOnRN(tick);
  }
}

/** Owns native touch capture through release, including a reversal after either pane is covered. */
export function usePaneDividerGesture({
  alternate,
  anchor,
  enabled,
  geometry,
  onLand,
  onTap,
  pair,
}: {
  readonly alternate: { readonly anchor: number; readonly pair: PanePair } | null;
  readonly anchor: number;
  readonly enabled: boolean;
  readonly geometry: PaneMotionState;
  readonly onLand: (landing: DividerLanding, source: PanePair, width: number) => void;
  readonly onTap: (source: PanePair) => void;
  readonly pair: PanePair;
}): {
  readonly gesture: ReturnType<typeof Gesture.Exclusive>;
  readonly press: SharedValue<number>;
  readonly source: SharedValue<PanePair>;
} {
  const source = useSharedValue(pair);
  const press = useSharedValue(0);
  const origin = useSharedValue(0);
  const startX = useSharedValue(0);
  const edge = useSharedValue(0);
  // Offset from the finger only while latching or reopening a covered pane.
  const snapOffset = useSharedValue(0);
  const reducedMotion = useReducedMotionPreference();
  const density = PixelRatio.get();
  const locked = useSharedValue<CoveredEdge>("none");
  const buzzed = useSharedValue(false);
  const active = useSharedValue(false);
  useAnimatedReaction(
    () => edge.get() + snapOffset.get(),
    (position) => {
      const current = geometry.drag.get();
      if (current === null) {
        return;
      }
      const width = geometry.frameWidth.get();
      const visible = Math.max(0, Math.min(width, Math.round(position * density) / density));
      const selected = source.get();
      const previous =
        selected === "left+center" ? current.catalogVisibleWidth : current.centerClipWidth;
      if (visible !== previous) {
        geometry.drag.set(previewDivider(selected, { edge: visible, width }, geometry.from.get()));
      }
    },
  );
  // The frame detector lets vertical drags reach the pane scroll view.
  const acceptTouch = (event: GestureTouchEvent, manager: GestureStateManager): number | null => {
    "worklet";
    const touch = event.allTouches[0];
    if (event.numberOfTouches !== 1 || touch === undefined) {
      manager.fail();
      return null;
    }
    const frame = measure(geometry.frameRef);
    if (
      frame === null ||
      Math.abs(touch.y - frame.height * HALF) > frame.height * DIVIDER_HIT_SHARE * HALF
    ) {
      manager.fail();
      return null;
    }
    if (Math.abs(touch.x - dividerAnchor(geometry, pair, anchor)) <= touchTarget * HALF) {
      source.set(pair);
    } else if (
      alternate !== null &&
      Math.abs(touch.x - dividerAnchor(geometry, alternate.pair, alternate.anchor)) <=
        touchTarget * HALF
    ) {
      source.set(alternate.pair);
    } else {
      manager.fail();
      return null;
    }
    return touch.absoluteX;
  };
  const pan = Gesture.Pan()
    .enabled(enabled)
    .onTouchesDown((event, manager) => {
      const x = acceptTouch(event, manager);
      if (x !== null) {
        geometry.dividerPressed.set(true);
        startX.set(x);
        press.set(withSpring(1));
      }
    })
    .activeOffsetX([-PAN_SLOP, PAN_SLOP])
    .failOffsetY([-TAP_SLOP, TAP_SLOP])
    .maxPointers(1)
    .onStart(() => {
      const selected = source.get();
      const width = measure(geometry.frameRef)?.width ?? 0;
      if (width <= 0) {
        return;
      }
      const arrangement = geometry.arrangement.get();
      const base = geometry.moving.get()
        ? movingPaneGeometry(geometry)
        : paneGeometry(arrangement, width);
      active.set(true);
      geometry.landing.set(null);
      geometry.from.set(base);
      cancelAnimation(snapOffset);
      const x = selected === "left+center" ? base.catalogVisibleWidth : base.centerClipWidth;
      snapOffset.set(0);
      origin.set(x);
      edge.set(x);
      locked.set(x <= 0 ? "leading" : x >= width ? "trailing" : "none");
      buzzed.set(locked.get() !== "none");
      cancelAnimation(geometry.progress);
      geometry.frameWidth.set(width);
      geometry.drag.set(previewDivider(selected, { edge: x, width }, base));
      geometry.moving.set(true);
    })
    .onUpdate((event) => {
      if (geometry.drag.get() === null) {
        return;
      }
      if (event.numberOfPointers !== 1) {
        cancelDividerDrag(geometry);
        return;
      }
      const selected = source.get();
      const width = geometry.frameWidth.get();
      const raw = origin.get() + event.absoluteX - startX.get();
      const remaining = selected === "left+center" ? raw : Math.min(raw, width - raw);
      detentHaptic(remaining, width * MIN_PANE_SHARE, buzzed);
      const previous = locked.get();
      const next = dividerPosition(selected, width, { locked: previous, raw });
      if (edge.get() === next.edge && previous === next.locked) {
        return;
      }
      if (next.locked !== previous) {
        const shown = edge.get() + snapOffset.get();
        startSnap(snapOffset, shown - next.edge, reducedMotion);
        locked.set(next.locked);
      }
      edge.set(next.edge);
    })
    .onEnd((_event, success) => {
      if (!success || geometry.drag.get() === null) {
        return;
      }
      const selected = source.get();
      const width = geometry.frameWidth.get();
      const result = landingAt(selected, width, { edge: edge.get(), side: locked.get() });
      const target = result.kind === "split" ? (result.percent / FULL_PERCENT) * width : edge.get();
      geometry.landing.set(previewDivider(selected, { edge: target, width }, geometry.from.get()));
      // Preserve the cover scrim through its landing, including a return to the original split.
      // A changed open split hands its current frame directly to the preset resize transition.
      if (handOffOpenSplit(result, target, { edge: edge.get(), origin: origin.get() })) {
        cancelAnimation(snapOffset);
        scheduleOnRN(onLand, result, selected, width);
        return;
      }
      const shown = edge.get() + snapOffset.get();
      cancelAnimation(snapOffset);
      edge.set(target);
      if (reducedMotion || Math.abs(shown - target) < 1 / density) {
        snapOffset.set(0);
        scheduleOnRN(onLand, result, selected, width);
        return;
      }
      snapOffset.set(shown - target);
      snapOffset.set(
        withSpring(0, PANE_SPRING, (finished) => {
          if (finished === true && geometry.drag.get() !== null) {
            scheduleOnRN(onLand, result, selected, width);
          }
        }),
      );
    })
    .onFinalize((_event, success) => {
      geometry.dividerPressed.set(false);
      press.set(withSpring(0));
      if (!success && active.get()) {
        cancelDividerDrag(geometry);
      }
      active.set(false);
    });
  const tap = Gesture.Tap()
    .enabled(enabled)
    .onTouchesDown((event, manager) => {
      acceptTouch(event, manager);
    })
    .maxDistance(TAP_SLOP)
    .onEnd((_event, success) => {
      if (success) {
        scheduleOnRN(onTap, source.get());
      }
    });
  return { gesture: Gesture.Exclusive(pan, tap), press, source };
}
