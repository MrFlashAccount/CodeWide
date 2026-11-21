import type { LegendListRef } from "@legendapp/list/react-native";
import { findNodeHandle, Platform, type NativeScrollEvent } from "react-native";
import { useEvent as useWorkletEvent, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { useEvent } from "../../react/useEvent";
import type { ThreadListFabModel } from "./threadListFabModel";
import {
  INITIAL_THREAD_LIST_FAB_VISIBILITY,
  nextThreadListFabVisibility,
} from "./threadListFabVisibility";

const SCROLL_EVENT_NAMES = [
  "onScroll",
  "onScrollBeginDrag",
  "onScrollEndDrag",
  "onMomentumScrollBegin",
  "onMomentumScrollEnd",
] as const;

/** The native registration surface Reanimated attaches to a `useEvent` handler. */
type ScrollEventRegistration = {
  readonly registerForEvents: (viewTag: number) => void;
  readonly unregisterFromEvents: (viewTag: number) => void;
};

function isScrollEventRegistration(value: unknown): value is ScrollEventRegistration {
  return (
    typeof value === "object" &&
    value !== null &&
    "registerForEvents" in value &&
    typeof value.registerForEvents === "function" &&
    "unregisterFromEvents" in value &&
    typeof value.unregisterFromEvents === "function"
  );
}

/**
 * Reanimated exposes a `useEvent` handler's native registration only through
 * `workletEventHandler`, as its own `useScrollOffset` does. A shape that does
 * not match leaves the actions permanently shown instead of failing.
 */
function scrollEventRegistration(handler: unknown): ScrollEventRegistration | null {
  if (typeof handler !== "object" || handler === null || !("workletEventHandler" in handler)) {
    return null;
  }
  return isScrollEventRegistration(handler.workletEventHandler)
    ? handler.workletEventHandler
    : null;
}

/**
 * Drives floating-action visibility from one list's native scroll events on
 * the UI thread. The list's own JS `onScroll` stays untouched: the worklet is
 * registered beside it on the scroll view, and only a shown/hidden transition
 * crosses to JS. Attaching or detaching a list scope shows the actions.
 */
export function useThreadListFabScroll(
  model: ThreadListFabModel,
): (list: LegendListRef | null) => (() => void) | undefined {
  const { visibility } = model;
  const dragging = useSharedValue(false);
  const momentum = useSharedValue(false);
  const publishShown = useEvent((shown: boolean): void => {
    model.shown$.set(shown);
  });
  const handler = useWorkletEvent<NativeScrollEvent>((event) => {
    "worklet";
    const name = event.eventName;
    let tracking = true;
    if (name.endsWith("onScrollBeginDrag")) {
      dragging.set(true);
      // A gesture measures its own travel from where it started.
      tracking = false;
    } else if (name.endsWith("onScrollEndDrag")) {
      dragging.set(false);
    } else if (name.endsWith("onMomentumScrollBegin")) {
      momentum.set(true);
    } else if (name.endsWith("onMomentumScrollEnd")) {
      momentum.set(false);
    } else {
      tracking = dragging.get() || momentum.get();
    }
    const previous = visibility.get();
    const next = nextThreadListFabVisibility(previous, {
      maxOffset: event.contentSize.height - event.layoutMeasurement.height,
      offset: event.contentOffset.y,
      tracking,
    });
    if (next === previous) {
      return;
    }
    visibility.set(next);
    if (next.shown !== previous.shown) {
      scheduleOnRN(publishShown, next.shown);
    }
  }, SCROLL_EVENT_NAMES);
  const showForScope = useEvent((): void => {
    dragging.set(false);
    momentum.set(false);
    visibility.set(INITIAL_THREAD_LIST_FAB_VISIBILITY);
    model.shown$.set(true);
  });
  return useEvent((list: LegendListRef | null): (() => void) | undefined => {
    if (list === null) {
      return undefined;
    }
    showForScope();
    const registration = scrollEventRegistration(handler);
    // Web scroll views have no native tag; their actions stay shown.
    const viewTag =
      Platform.OS === "web" || registration === null
        ? null
        : findNodeHandle(list.getNativeScrollRef());
    if (registration === null || viewTag === null) {
      return showForScope;
    }
    registration.registerForEvents(viewTag);
    return () => {
      registration.unregisterFromEvents(viewTag);
      showForScope();
    };
  });
}
