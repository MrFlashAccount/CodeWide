import { observable, type Observable } from "@legendapp/state";
import { selectionAsync } from "expo-haptics";
import { createContext, useContext, useEffect } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import { useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import { controlSize, spacing } from "../../theme";

/** Downward travel that arms the shared catalog search interaction. */
export const CATALOG_SEARCH_PULL_THRESHOLD = controlSize.touch + spacing.xl;
const MAX_PULL_DISTANCE = CATALOG_SEARCH_PULL_THRESHOLD + controlSize.regular;
const PULL_SPRING = {
  damping: spacing.md + spacing.optical,
  mass: spacing.compact / spacing.inputInset,
  stiffness: MAX_PULL_DISTANCE,
} as const;

/** Semantic state published to catalog search chrome without bridging gesture frames. */
export type CatalogSearchPullPhase = "armed" | "idle";

/** One catalog's native distance and narrowly observed semantic phase. */
export type CatalogSearchPullModel = {
  readonly distance: SharedValue<number>;
  readonly phase$: Observable<CatalogSearchPullPhase>;
};

/** Stable inputs for attaching the shared search gesture to a catalog viewport. */
export type CatalogSearchPullGestureOptions = {
  readonly enabled: boolean;
  readonly gestureTestID?: string;
  readonly initialOffset: number;
  readonly onOpenSearch: () => void;
  readonly scope: string;
};

/** Shared state between one catalog's fixed search row and list gesture. */
export const CatalogSearchPullContext = createContext<CatalogSearchPullModel | null>(null);

/** Returns the catalog-owned gesture model for narrowly subscribed presentation. */
export function useCatalogSearchPullModel(): CatalogSearchPullModel | null {
  return useContext(CatalogSearchPullContext);
}

/** Watches catalog offset and opens search after the shared pull threshold. */
export function useCatalogSearchPullGesture({
  enabled,
  gestureTestID = "catalog-pull-to-search",
  initialOffset,
  onOpenSearch,
  scope,
}: CatalogSearchPullGestureOptions): {
  readonly gesture: ReturnType<typeof Gesture.Simultaneous>;
  readonly onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
} {
  const model = useCatalogSearchPullModel();
  const fallbackDistance = useSharedValue(0);
  const fallbackPhase$ = useConstant(() => observable<CatalogSearchPullPhase>("idle"));
  const distance = model?.distance ?? fallbackDistance;
  const phase$ = model?.phase$ ?? fallbackPhase$;
  const offset = useSharedValue(initialOffset);
  const armed = useSharedValue(false);
  const hapticPlayed = useSharedValue(false);
  const openSearch = useEvent(onOpenSearch);
  const publishPhase = useEvent((phase: CatalogSearchPullPhase): void => {
    phase$.set(phase);
  });
  const onScroll = useEvent((event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    offset.set(Math.max(0, event.nativeEvent.contentOffset.y));
  });
  useEffect(() => {
    offset.set(Math.max(0, initialOffset));
  }, [initialOffset, offset, scope]);
  const pan = Gesture.Pan()
    .withTestId(gestureTestID)
    .enabled(enabled)
    .minDistance(spacing.xl)
    .maxPointers(1)
    .activeOffsetY(spacing.xs)
    .failOffsetX([-spacing.lg, spacing.lg])
    .failOffsetY(-spacing.xs)
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
      const nextArmed = distance.get() >= CATALOG_SEARCH_PULL_THRESHOLD;
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

function playSearchReadyHaptic(): void {
  void selectionAsync().catch(() => undefined);
}
