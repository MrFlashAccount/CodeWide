import { createContext, useContext } from "react";
import type { AnimatedRef, DerivedValue } from "react-native-reanimated";

import { NativePaneSnapshot } from "./nativePaneSnapshot";

/** The layout used for a pane's reading surface during rearrangement. */
export type PaneBodyMode = "fixed" | "live" | "snapshot";
const requested = process.env.EXPO_PUBLIC_PANE_BODY_MODE;
const supportedDefault = NativePaneSnapshot === null ? "fixed" : "snapshot";
export const PaneBodyModeContext = createContext<PaneBodyMode>(
  requested === "live" || requested === "fixed" ? requested : supportedDefault,
);

/** A finger-controlled width can change every frame; a committed width is the final layout. */
export type PaneReadingWidth =
  | { readonly kind: "drag" | "landing"; readonly width: number }
  | { readonly kind: "rest" };

/** The frame's navigation snapshot events and resize state for the reading surface. */
export const PaneBodyPlacementContext = createContext<{
  readonly readingWidth: DerivedValue<PaneReadingWidth>;
  readonly resizing: DerivedValue<boolean>;
  readonly subscribeCapture: (capture: () => void) => () => void;
} | null>(null);

/** Standalone reading surfaces keep their ordinary layout outside a moving pane frame. */
export function usePaneBodyMode(): PaneBodyMode {
  const mode = useContext(PaneBodyModeContext);
  const placement = useContext(PaneBodyPlacementContext);
  return mode === "snapshot" && placement === null ? "fixed" : mode;
}

/** The snapshot immediately surrounding this reading surface, when supported on Android. */
export const PaneBodySnapshotRefContext = createContext<AnimatedRef<
  React.ComponentRef<NonNullable<typeof NativePaneSnapshot>>
> | null>(null);
