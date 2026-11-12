/**
 * Distance the user must scroll in one direction before the floating actions
 * hide or reappear. Jitter below it never toggles them.
 */
export const THREAD_LIST_FAB_DIRECTION_THRESHOLD = 24;

/** Offsets at or above the top of the list within this distance always show the actions. */
export const THREAD_LIST_FAB_TOP_REGION = 24;

/**
 * Scroll-driven visibility of the thread list floating actions. `anchor` is the
 * extreme offset reached in the current direction: the lowest offset while
 * shown, the highest while hidden.
 */
export type ThreadListFabVisibility = {
  readonly anchor: number;
  readonly shown: boolean;
};

/** One native scroll sample observed on the UI thread. */
export type ThreadListFabScrollSample = {
  /** Largest in-bounds offset; zero or less when the content does not scroll. */
  readonly maxOffset: number;
  readonly offset: number;
  /** False outside a user drag or fling, for example when rows are inserted above. */
  readonly tracking: boolean;
};

/** Every list scope begins with its actions visible. */
export const INITIAL_THREAD_LIST_FAB_VISIBILITY: ThreadListFabVisibility = {
  anchor: 0,
  shown: true,
};

function anchoredAt(
  state: ThreadListFabVisibility,
  offset: number,
  shown: boolean,
): ThreadListFabVisibility {
  "worklet";
  return state.anchor === offset && state.shown === shown ? state : { anchor: offset, shown };
}

/** Shown actions follow the lowest offset and hide after enough downward travel from it. */
function nextWhileShown(state: ThreadListFabVisibility, offset: number): ThreadListFabVisibility {
  "worklet";
  if (offset < state.anchor) {
    return anchoredAt(state, offset, true);
  }
  return offset - state.anchor >= THREAD_LIST_FAB_DIRECTION_THRESHOLD
    ? anchoredAt(state, offset, false)
    : state;
}

/** Hidden actions follow the highest offset and show after enough upward travel from it. */
function nextWhileHidden(state: ThreadListFabVisibility, offset: number): ThreadListFabVisibility {
  "worklet";
  if (offset > state.anchor) {
    return anchoredAt(state, offset, false);
  }
  return state.anchor - offset >= THREAD_LIST_FAB_DIRECTION_THRESHOLD
    ? anchoredAt(state, offset, true)
    : state;
}

/**
 * Applies one scroll sample with direction hysteresis. Pure and worklet-safe:
 * the UI thread calls it for every scroll event without crossing to JS.
 */
export function nextThreadListFabVisibility(
  state: ThreadListFabVisibility,
  sample: ThreadListFabScrollSample,
): ThreadListFabVisibility {
  "worklet";
  const { maxOffset, offset } = sample;
  if (maxOffset <= 0 || offset <= THREAD_LIST_FAB_TOP_REGION) {
    return anchoredAt(state, offset, true);
  }
  if (offset > maxOffset) {
    // Overscroll past the end bounces back without user intent to change direction.
    return state;
  }
  if (!sample.tracking) {
    return anchoredAt(state, offset, state.shown);
  }
  return state.shown ? nextWhileShown(state, offset) : nextWhileHidden(state, offset);
}
