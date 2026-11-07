import { observable, type Observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { createContext, useContext, useLayoutEffect } from "react";
import { cancelAnimation, useSharedValue, type SharedValue } from "react-native-reanimated";
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
 * The UI-thread state of one frame's pane geometry. `arrangement` is the settled target; while
 * `moving`, every pane derives its frame from `from`, the target and the one `progress`.
 */
export type PaneMotionState = {
  readonly arrangement: SharedValue<PaneArrangement>;
  readonly frameWidth: SharedValue<number>;
  readonly from: SharedValue<PaneGeometry>;
  readonly moving: SharedValue<boolean>;
  readonly progress: SharedValue<number>;
};

/** The frame's pane geometry now; every pane's animated style reads it. */
export function currentPaneGeometry(state: PaneMotionState): PaneGeometry {
  "worklet";
  const to = paneGeometry(state.arrangement.get(), state.frameWidth.get());
  return state.moving.get()
    ? interpolatePaneGeometry(state.from.get(), to, state.progress.get())
    : to;
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
 * Starts one rearrangement on the UI thread: it springs from wherever the panes are now, so an
 * interrupted motion continues without a jump. Without `animate` the panes take `next` at once.
 */
export function startPaneMotion(
  state: PaneMotionState,
  { animate, generation, next, onSettled }: PaneMotionRequest,
): void {
  "worklet";
  if (!animate) {
    cancelAnimation(state.progress);
    state.arrangement.set(next);
    state.moving.set(false);
    state.progress.set(1);
    return;
  }
  state.from.set(currentPaneGeometry(state));
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
 * Owns one frame's pane geometry. React resolves the settled `arrangement`; one layout effect
 * per changed arrangement hands it to the UI thread, which springs a single progress that every
 * pane property derives from. No pane starts its own animation.
 */
export function usePaneMotionState(
  arrangement: PaneArrangement,
  initialFrameWidth: number,
): PaneMotionState {
  const motion = useContext(PaneMotionContext);
  const reducedMotion = useReducedMotionPreference();
  const arrangementValue = useSharedValue(arrangement);
  const frameWidth = useSharedValue(initialFrameWidth);
  const from = useSharedValue(paneGeometry(arrangement, initialFrameWidth));
  const moving = useSharedValue(false);
  const progress = useSharedValue(1);
  const { centerLeftRadius, centerRightRadius, left, right, sidebarWidth } = arrangement;
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
      { arrangement: arrangementValue, frameWidth, from, moving, progress },
      {
        animate,
        generation: generation ?? -1,
        next: { centerLeftRadius, centerRightRadius, left, right, sidebarWidth },
        onSettled: motion.settle,
      },
    );
  }, [
    arrangementValue,
    centerLeftRadius,
    centerRightRadius,
    frameWidth,
    from,
    left,
    motion,
    moving,
    progress,
    reducedMotion,
    right,
    sidebarWidth,
  ]);
  return { arrangement: arrangementValue, frameWidth, from, moving, progress };
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
