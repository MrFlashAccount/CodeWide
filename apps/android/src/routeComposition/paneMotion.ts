import { observable, type Observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { createContext, useContext, useLayoutEffect } from "react";
import type { View } from "react-native";
import {
  cancelAnimation,
  measure,
  useSharedValue,
  type AnimatedRef,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";

import { useReducedMotionPreference } from "../rendering/reduced-motion-store";
import {
  interpolatePaneGeometry,
  paneGeometry,
  type PaneArrangement,
  type PaneGeometry,
} from "./paneGeometry";
import { PANE_SPRING_DURATION_MS, paneSpring } from "./paneMotionSpec";

/** Slack after which an armed rearrangement that moved no pane disarms. */
const SETTLE_SLACK_MS = 80;

/**
 * Pane geometry animates only for an intentional rearrangement (opening, closing or resizing a
 * pane). First placement, tab reveal, data arrival and viewport changes move panes instantly.
 */
export type PaneMotion = {
  /** Whether a rearrangement is armed or still moving; a leaving pane stays mounted meanwhile. */
  readonly armed$: Observable<boolean>;
  /** The armed rearrangement a geometry change belongs to, or `null` outside one. */
  readonly claim: () => number | null;
  /** Arms the pane motion and applies `change` at once; its geometry change springs. */
  readonly rearrange: (change: () => void) => void;
  /** Ends rearrangement `generation` once its panes have settled. */
  readonly settle: (generation: number) => void;
};

/** A fresh, unarmed rearrangement window for one pane frame. */
export function createPaneMotion(): PaneMotion {
  const armed$ = observable(false);
  let generation = 0;
  let fallback: ReturnType<typeof setTimeout> | null = null;
  const clearFallback = (): void => {
    if (fallback !== null) {
      clearTimeout(fallback);
      fallback = null;
    }
  };
  const settle = (settled: number): void => {
    if (settled === generation) {
      clearFallback();
      armed$.set(false);
    }
  };
  return {
    armed$,
    claim() {
      if (!armed$.peek()) {
        return null;
      }
      // The spring now owns the window and settles it.
      clearFallback();
      return generation;
    },
    rearrange(change) {
      generation += 1;
      const current = generation;
      clearFallback();
      armed$.set(true);
      fallback = setTimeout(() => {
        settle(current);
      }, PANE_SPRING_DURATION_MS + SETTLE_SLACK_MS);
      change();
    },
    settle,
  };
}

/** Outside a pane frame nothing rearranges, so changes apply directly. */
const UNARMED: PaneMotion = {
  armed$: observable(false),
  claim: () => null,
  rearrange: (change) => {
    change();
  },
  settle: () => undefined,
};

/** The pane frame's motion owner; `PaneMotionProvider` supplies it. */
export const PaneMotionContext = createContext<PaneMotion>(UNARMED);

/**
 * The UI-thread state of one frame's pane geometry. `arrangement` is the settled target, which
 * Yoga lays out at rest. Only while `moving` do the panes take explicit pixels, derived from
 * `from`, the target in a frame `frameWidth` wide and the one `progress`; `frameWidth` is the
 * frame measured on the UI thread when the motion started and feeds nothing else.
 */
export type PaneMotionState = {
  readonly arrangement: SharedValue<PaneArrangement>;
  /** The pane frame view, measured when a rearrangement starts. */
  readonly frameRef: AnimatedRef<View>;
  readonly frameWidth: SharedValue<number>;
  readonly from: SharedValue<PaneGeometry>;
  readonly moving: SharedValue<boolean>;
  readonly progress: SharedValue<number>;
};

/** The geometry the moving panes stand at now; meaningful only while `moving`. */
export function movingPaneGeometry(state: PaneMotionState): PaneGeometry {
  "worklet";
  const to = paneGeometry(state.arrangement.get(), state.frameWidth.get());
  return interpolatePaneGeometry(state.from.get(), to, state.progress.get());
}

/**
 * Where the panes stand when a rearrangement starts: an interrupted motion continues from its
 * current frame; panes at rest stand where Yoga laid them out, which is the settled geometry in
 * the frame as measured now.
 */
function standingPaneGeometry(state: PaneMotionState, frameWidth: number): PaneGeometry {
  "worklet";
  return state.moving.get()
    ? movingPaneGeometry(state)
    : paneGeometry(state.arrangement.get(), frameWidth);
}

/** Puts the panes at rest in `next`: Yoga lays them out from the relative pane styles. */
function settlePanes(state: PaneMotionState, next: PaneArrangement): void {
  "worklet";
  cancelAnimation(state.progress);
  state.arrangement.set(next);
  state.moving.set(false);
  state.progress.set(1);
}

/** One arrangement change handed to the UI thread. */
export type PaneMotionRequest = {
  /** Spring to `next`; otherwise the panes take it at once. */
  readonly animate: boolean;
  /** The rearrangement the spring settles, reported back through `onSettled`. */
  readonly generation: number;
  readonly next: PaneArrangement;
  readonly onSettled: (generation: number) => void;
};

/**
 * Starts one rearrangement on the UI thread. It measures the frame now, so the motion's ends come
 * from the actual layout rather than an earlier JavaScript measurement, and springs from wherever
 * the panes are, so an interrupted motion continues without a jump. When the spring settles the
 * panes return to Yoga, whose layout equals the motion's explicit end. Without `animate`, or
 * without a measurable frame, the panes settle into `next` at once.
 */
export function startPaneMotion(
  state: PaneMotionState,
  { animate, generation, next, onSettled }: PaneMotionRequest,
): void {
  "worklet";
  const frameWidth = animate ? (measure(state.frameRef)?.width ?? 0) : 0;
  if (frameWidth <= 0) {
    settlePanes(state, next);
    if (animate) {
      scheduleOnRN(onSettled, generation);
    }
    return;
  }
  state.from.set(standingPaneGeometry(state, frameWidth));
  state.frameWidth.set(frameWidth);
  state.arrangement.set(next);
  state.moving.set(true);
  state.progress.set(0);
  state.progress.set(
    paneSpring((finished) => {
      if (finished === true) {
        state.moving.set(false);
        scheduleOnRN(onSettled, generation);
      }
    }),
  );
}

/**
 * Owns one frame's pane geometry; `frameRef` is the pane frame view it measures when a motion
 * starts. React resolves the settled `arrangement`; one layout effect
 * per changed arrangement hands it to the UI thread, which springs a single progress that every
 * pane property derives from. No pane starts its own animation.
 */
export function usePaneMotionState(
  arrangement: PaneArrangement,
  frameRef: AnimatedRef<View>,
): PaneMotionState {
  const motion = useContext(PaneMotionContext);
  const reducedMotion = useReducedMotionPreference();
  const arrangementValue = useSharedValue(arrangement);
  // Both are written when a motion starts; at rest no pane reads them.
  const frameWidth = useSharedValue(0);
  const from = useSharedValue(paneGeometry(arrangement, 0));
  const moving = useSharedValue(false);
  const progress = useSharedValue(1);
  const { centerLeftRadius, centerRightRadius, left, right, sidebar } = arrangement;
  // WHY: the shared values are Reanimated's UI-thread store; the effect publishes the committed
  // arrangement to it exactly once per change, after the commit that mounted any arriving pane.
  useLayoutEffect(() => {
    const generation = motion.claim();
    const animate = generation !== null && !reducedMotion;
    if (generation !== null && !animate) {
      motion.settle(generation);
    }
    scheduleOnUI(
      startPaneMotion,
      { arrangement: arrangementValue, frameRef, frameWidth, from, moving, progress },
      {
        animate,
        generation: generation ?? -1,
        next: { centerLeftRadius, centerRightRadius, left, right, sidebar },
        onSettled: motion.settle,
      },
    );
  }, [
    arrangementValue,
    centerLeftRadius,
    centerRightRadius,
    frameRef,
    frameWidth,
    from,
    left,
    motion,
    moving,
    progress,
    reducedMotion,
    right,
    sidebar,
  ]);
  return { arrangement: arrangementValue, frameRef, frameWidth, from, moving, progress };
}

/** Whether this frame's rearrangement is armed or still moving. */
export function usePaneMotionArmed(): boolean {
  const motion = useContext(PaneMotionContext);
  return useSelector(() => motion.armed$.get());
}

/** Runs an intentional pane rearrangement with its motion armed. */
export function usePaneRearrangement(): (change: () => void) => void {
  return useContext(PaneMotionContext).rearrange;
}
