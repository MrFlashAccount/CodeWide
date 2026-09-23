import { observable, type Observable } from "@legendapp/state";
import { selectionAsync } from "expo-haptics";
import { createContext, useContext, useEffect } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import { useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { useEvent } from "../../react/useEvent";
import { useConstant } from "../../react/useConstant";

export const PULL_TO_SEARCH_THRESHOLD = 80;
const MAX_PULL_DISTANCE = 120;
const PAN_START_DISTANCE = 8;
const PAN_HORIZONTAL_TOLERANCE = 24;
const PAN_NON_DIRECTIONAL_DISTANCE = 32;
const PULL_SPRING_DAMPING = 18;
const PULL_SPRING_MASS = 0.6;
const PULL_SPRING_STIFFNESS = 120;
const PULL_SPRING = {
  damping: PULL_SPRING_DAMPING,
  mass: PULL_SPRING_MASS,
  stiffness: PULL_SPRING_STIFFNESS,
} as const;

function playSearchReadyHaptic(): void {
  void selectionAsync().catch(() => undefined);
}

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
export function useThreadListPullGesture(
  onOpenSearch: () => void,
  initialOffset: number,
  scope: string,
): {
  readonly gesture: ReturnType<typeof Gesture.Simultaneous>;
  readonly onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
} {
  const model = useThreadListSearchPullModel();
  const fallbackDistance = useSharedValue(0);
  const fallbackPhase$ = useConstant(() => observable<ThreadListSearchPullPhase>("idle"));
  const distance = model?.distance ?? fallbackDistance;
  const phase$ = model?.phase$ ?? fallbackPhase$;
  const offset = useSharedValue(initialOffset);
  const armed = useSharedValue(false);
  const hapticPlayed = useSharedValue(false);
  const openSearch = useEvent(onOpenSearch);
  const publishPhase = useEvent((phase: ThreadListSearchPullPhase): void => {
    phase$.set(phase);
  });
  const onScroll = useEvent((event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    offset.set(Math.max(0, event.nativeEvent.contentOffset.y));
  });
  useEffect(() => {
    offset.set(Math.max(0, initialOffset));
  }, [initialOffset, offset, scope]);
  const pan = Gesture.Pan()
    .withTestId("thread-list-pull-to-search")
    // Keep radial activation beyond the horizontal/upward failure bounds; only downward travel activates.
    .minDistance(PAN_NON_DIRECTIONAL_DISTANCE)
    .maxPointers(1)
    .activeOffsetY(PAN_START_DISTANCE)
    .failOffsetX([-PAN_HORIZONTAL_TOLERANCE, PAN_HORIZONTAL_TOLERANCE])
    .failOffsetY(-PAN_START_DISTANCE)
    .onTouchesDown((_event, manager) => {
      if (offset.get() > 0) {
        manager.fail();
      }
    })
    .onUpdate((event) => {
      if (offset.get() > 0 || event.translationY <= 0) {
        distance.set(0);
      } else {
        distance.set(Math.min(MAX_PULL_DISTANCE, event.translationY));
      }
      const nextArmed = distance.get() >= PULL_TO_SEARCH_THRESHOLD;
      if (nextArmed !== armed.get()) {
        armed.set(nextArmed);
        scheduleOnRN(publishPhase, nextArmed ? "armed" : "idle");
        if (nextArmed && !hapticPlayed.get()) {
          hapticPlayed.set(true);
          scheduleOnRN(playSearchReadyHaptic);
        }
      }
    })
    .onEnd((_event, success) => {
      if (success && armed.get()) {
        scheduleOnRN(openSearch);
      }
    })
    .onFinalize(() => {
      distance.set(withSpring(0, PULL_SPRING));
      hapticPlayed.set(false);
      if (armed.get()) {
        armed.set(false);
        scheduleOnRN(publishPhase, "idle");
      }
    });
  return { gesture: Gesture.Simultaneous(pan, Gesture.Native()), onScroll };
}
