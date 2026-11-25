import { HALF_PERCENT } from "../ui/paneSplitSizes";
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
import { paneSpring } from "./paneMotionSpec";

/** Allow a slow destination commit to claim a rearrangement even when the spring is short. */
const UNCLAIMED_MOTION_TIMEOUT_MS = 540;

/**
 * Pane geometry animates only for an intentional rearrangement (opening, closing or resizing a
 * pane). First placement, tab reveal, data arrival and viewport changes move panes instantly.
 */
export type PaneMotion = {
  /** Whether a rearrangement is armed or still moving; a leaving pane stays mounted meanwhile. */
  readonly armed$: Observable<boolean>;
  readonly captureBodies: () => void;
  /** The armed rearrangement a geometry change belongs to, or `null` outside one. */
  readonly claim: () => number | null;
  /** Arms the pane motion and applies `change` at once; its geometry change springs. */
  readonly rearrange: (change: () => void) => void;
  /** Resizes live reading content as the divider moves and settles. */
  readonly resize: (change: () => void) => void;
  /** Ends rearrangement `generation` once its panes have settled. */
  readonly settle: (generation: number) => void;
  readonly subscribeCapture: (capture: () => void) => () => void;
};

/** A fresh, unarmed rearrangement window for one pane frame. */
export function createPaneMotion(): PaneMotion {
  const armed$ = observable(false);
  const captures = new Set<() => void>();
  let generation = 0;
  let captureOnClaim = false;
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
  function arm(change: () => void, capture: boolean): void {
    generation += 1;
    const current = generation;
    captureOnClaim = capture;
    clearFallback();
    armed$.set(true);
    fallback = setTimeout(() => {
      settle(current);
    }, UNCLAIMED_MOTION_TIMEOUT_MS);
    change();
  }
  return {
    armed$,
    captureBodies() {
      if (captureOnClaim) {
        captureOnClaim = false;
        for (const capture of captures) {
          capture();
        }
      }
    },
    claim() {
      if (!armed$.peek()) {
        return null;
      }
      clearFallback();
      return generation;
    },
    rearrange(change) {
      arm(change, true);
    },
    resize(change) {
      arm(change, false);
    },
    settle,
    subscribeCapture(capture) {
      captures.add(capture);
      return () => {
        captures.delete(capture);
      };
    },
  };
}

/** Outside a pane frame nothing rearranges, so changes apply directly. */
const UNARMED: PaneMotion = {
  armed$: observable(false),
  captureBodies: () => undefined,
  claim: () => null,
  rearrange: (change) => {
    change();
  },
  resize(change) {
    change();
  },
  settle: () => undefined,
  subscribeCapture: () => () => undefined,
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
  readonly dividerPressed: SharedValue<boolean>;
  readonly drag: SharedValue<PaneGeometry | null>;
  /** The pane frame view, measured when a rearrangement starts. */
  readonly frameRef: AnimatedRef<View>;
  readonly frameWidth: SharedValue<number>;
  readonly from: SharedValue<PaneGeometry>;
  /** Identifies a preset already started from its press before React commits that same change. */
  readonly generation: SharedValue<number>;
  /** Known final reading widths, published once a preset is chosen or the finger lifts. */
  readonly landing: SharedValue<PaneGeometry | null>;
  readonly moving: SharedValue<boolean>;
  readonly progress: SharedValue<number>;
};

/** The geometry the moving panes stand at now; meaningful only while `moving`. */
export function movingPaneGeometry(state: PaneMotionState): PaneGeometry {
  "worklet";
  const drag = state.drag.get();
  if (drag !== null) {
    return drag;
  }
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
  state.drag.set(null);
  state.landing.set(null);
  state.frameWidth.set(0);
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

function sameArrangement(current: PaneArrangement, next: PaneArrangement): boolean {
  "worklet";
  return (
    current.left === next.left &&
    current.right === next.right &&
    current.sidebar === next.sidebar &&
    current.catalogPercent === next.catalogPercent &&
    current.centerPercent === next.centerPercent &&
    current.centerLeftRadius === next.centerLeftRadius &&
    current.centerRightRadius === next.centerRightRadius
  );
}

function isRunningRequest(
  state: PaneMotionState,
  request: PaneMotionRequest,
  width: number,
): boolean {
  "worklet";
  return (
    state.generation.get() === request.generation &&
    state.frameWidth.get() === width &&
    sameArrangement(state.arrangement.get(), request.next)
  );
}

/**
 * Starts one rearrangement on the UI thread. It measures the frame now, so the motion's ends come
 * from the actual layout rather than an earlier JavaScript measurement, and springs from wherever
 * the panes are, so an interrupted motion continues without a jump. When the spring settles the
 * panes return to Yoga, whose layout equals the motion's explicit end. Without `animate`, or
 * without a measurable frame, the panes settle into `next` at once.
 */
export function startPaneMotion(state: PaneMotionState, request: PaneMotionRequest): void {
  "worklet";
  const { animate, generation, next, onSettled } = request;
  const frameWidth = animate ? (measure(state.frameRef)?.width ?? 0) : 0;
  if (frameWidth <= 0) {
    settlePanes(state, next);
    if (animate) {
      scheduleOnRN(onSettled, generation);
    }
    return;
  }
  if (isRunningRequest(state, request, frameWidth)) {
    return;
  }
  state.generation.set(generation);
  state.from.set(standingPaneGeometry(state, frameWidth));
  state.drag.set(null);
  state.frameWidth.set(frameWidth);
  state.arrangement.set(next);
  state.landing.set(paneGeometry(next, frameWidth));
  state.moving.set(true);
  state.progress.set(0);
  state.progress.set(
    paneSpring((finished) => {
      if (finished === true) {
        state.moving.set(false);
        state.landing.set(null);
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
  const stagedGeneration = useSharedValue(-1);
  const drag = useSharedValue<PaneGeometry | null>(null);
  const landing = useSharedValue<PaneGeometry | null>(null);
  const moving = useSharedValue(false);
  const dividerPressed = useSharedValue(false);
  const progress = useSharedValue(1);
  const {
    catalogPercent = null,
    centerLeftRadius,
    centerPercent = HALF_PERCENT,
    centerRightRadius,
    left,
    right,
    sidebar,
  } = arrangement;
  // WHY: the shared values are Reanimated's UI-thread store; the effect publishes the committed
  // arrangement to it exactly once per change, after the commit that mounted any arriving pane.
  useLayoutEffect(() => {
    const generation = motion.claim();
    const animate = generation !== null && !reducedMotion;
    if (generation !== null && !animate) {
      motion.settle(generation);
    }
    if (animate) {
      motion.captureBodies();
    }
    scheduleOnUI(
      startPaneMotion,
      {
        arrangement: arrangementValue,
        dividerPressed,
        drag,
        frameRef,
        frameWidth,
        from,
        generation: stagedGeneration,
        landing,
        moving,
        progress,
      },
      {
        animate,
        generation: generation ?? -1,
        next: {
          catalogPercent,
          centerLeftRadius,
          centerPercent,
          centerRightRadius,
          left,
          right,
          sidebar,
        },
        onSettled: motion.settle,
      },
    );
  }, [
    arrangementValue,
    catalogPercent,
    centerPercent,
    dividerPressed,
    drag,
    centerLeftRadius,
    centerRightRadius,
    frameRef,
    frameWidth,
    from,
    landing,
    left,
    motion,
    moving,
    progress,
    reducedMotion,
    stagedGeneration,
    right,
    sidebar,
  ]);
  return {
    arrangement: arrangementValue,
    dividerPressed,
    drag,
    frameRef,
    frameWidth,
    from,
    generation: stagedGeneration,
    landing,
    moving,
    progress,
  };
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
