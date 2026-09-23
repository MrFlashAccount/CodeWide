import { observable, type Observable } from "@legendapp/state";
import { createContext, useContext } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import { useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { useEvent } from "../../react/useEvent";
import { useConstant } from "../../react/useConstant";

const PULL_TO_SEARCH_THRESHOLD = 80;
const MAX_PULL_DISTANCE = 120;
const SCROLL_TOP_TOLERANCE = 1;
const PAN_START_DISTANCE = 8;
const PAN_HORIZONTAL_TOLERANCE = 24;
const PULL_SPRING_DAMPING = 18;
const PULL_SPRING_MASS = 0.6;
const PULL_SPRING_STIFFNESS = 120;
const PULL_SPRING = {
  damping: PULL_SPRING_DAMPING,
  mass: PULL_SPRING_MASS,
  stiffness: PULL_SPRING_STIFFNESS,
} as const;

export type ThreadListSearchPullPhase = "armed" | "idle";
export type ThreadListSearchPullModel = {
  readonly distance: SharedValue<number>;
  readonly phase$: Observable<ThreadListSearchPullPhase>;
};

/** Transient presentation state; the search session remains the query owner. */
export const ThreadListSearchPullContext = createContext<ThreadListSearchPullModel | null>(null);

/** Returns the feature-owned gesture model for narrowly subscribed presentation. */
export function useThreadListSearchPullModel(): ThreadListSearchPullModel | null {
  return useContext(ThreadListSearchPullContext);
}

/** Watches the list's current offset without publishing scroll frames to React. */
export function useThreadListPullGesture(onOpenSearch: () => void): {
  readonly gesture: ReturnType<typeof Gesture.Simultaneous>;
  readonly onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
} {
  const model = useThreadListSearchPullModel();
  const fallbackDistance = useSharedValue(0);
  const fallbackPhase$ = useConstant(() => observable<ThreadListSearchPullPhase>("idle"));
  const distance = model?.distance ?? fallbackDistance;
  const phase$ = model?.phase$ ?? fallbackPhase$;
  const offset = useSharedValue(0);
  const triggered = useSharedValue(false);
  const openSearch = useEvent(onOpenSearch);
  const publishPhase = useEvent((phase: ThreadListSearchPullPhase): void => {
    phase$.set(phase);
  });
  const onScroll = useEvent((event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    offset.set(Math.max(0, event.nativeEvent.contentOffset.y));
  });
  const pan = Gesture.Pan()
    .withTestId("thread-list-pull-to-search")
    .minDistance(PAN_START_DISTANCE)
    .maxPointers(1)
    .failOffsetX([-PAN_HORIZONTAL_TOLERANCE, PAN_HORIZONTAL_TOLERANCE])
    .onUpdate((event) => {
      if (offset.get() > SCROLL_TOP_TOLERANCE || event.translationY <= 0) {
        distance.set(0);
        return;
      }
      distance.set(Math.min(MAX_PULL_DISTANCE, event.translationY));
      if (distance.get() >= PULL_TO_SEARCH_THRESHOLD && !triggered.get()) {
        triggered.set(true);
        scheduleOnRN(publishPhase, "armed");
        scheduleOnRN(openSearch);
      }
    })
    .onFinalize(() => {
      distance.set(withSpring(0, PULL_SPRING));
      if (triggered.get()) {
        triggered.set(false);
        scheduleOnRN(publishPhase, "idle");
      }
    });
  return { gesture: Gesture.Simultaneous(pan, Gesture.Native()), onScroll };
}
