import { createContext, useContext } from "react";
import type { DerivedValue } from "react-native-reanimated";

import { NativePaneSnapshot } from "./nativePaneSnapshot";

/** The layout used for a pane's reading surface during rearrangement. */
export type PaneBodyMode = "fixed" | "live" | "snapshot";
const requested = process.env.EXPO_PUBLIC_PANE_BODY_MODE;
const supportedDefault = NativePaneSnapshot === null ? "fixed" : "snapshot";
export const PaneBodyModeContext = createContext<PaneBodyMode>(
  requested === "live" || requested === "fixed" ? requested : supportedDefault,
);

/** The final body allocation relative to its moving viewport, and the frame's capture event. */
export const PaneBodyPlacementContext = createContext<{
  readonly finalMargin: DerivedValue<number>;
  readonly subscribeCapture: (capture: () => void) => () => void;
} | null>(null);

/** Standalone reading surfaces keep their ordinary layout outside a moving pane frame. */
export function usePaneBodyMode(): PaneBodyMode {
  const mode = useContext(PaneBodyModeContext);
  const placement = useContext(PaneBodyPlacementContext);
  return mode === "snapshot" && placement === null ? "fixed" : mode;
}
