import { createContext, useContext } from "react";
import { StyleSheet } from "react-native";

import { colors } from "../theme";

/**
 * The surface a subtree is painted on. `raised` is the destination surface (the default for every
 * screen); `recessed` is the workspace frame that side panes such as the catalog sit on. A
 * recessed subtree paints its canvas in the frame color and raises its message surfaces to the
 * destination color, so content keeps the same contrast pair, inverted.
 */
export type SurfaceTone = "raised" | "recessed";

const SurfaceToneContext = createContext<SurfaceTone>("raised");

/** Declares the tone of the surface its subtree is placed on. */
export const SurfaceToneProvider = SurfaceToneContext.Provider;

/** The tone of the surface this component is placed on; `raised` outside any provider. */
export function useSurfaceTone(): SurfaceTone {
  return useContext(SurfaceToneContext);
}

const recessedStyles = StyleSheet.create({
  canvas: { backgroundColor: colors.threadListSurface },
  message: { backgroundColor: colors.conversationSurface },
});

/** Canvas override for a recessed surface; a raised surface keeps its own declared style. */
export function surfaceToneCanvasStyle(
  tone: SurfaceTone,
): typeof recessedStyles.canvas | undefined {
  return tone === "recessed" ? recessedStyles.canvas : undefined;
}

/** Message-surface override for a recessed surface; a raised surface keeps its declared style. */
export function surfaceToneMessageStyle(
  tone: SurfaceTone,
): typeof recessedStyles.message | undefined {
  return tone === "recessed" ? recessedStyles.message : undefined;
}

/** Opaque canvas color of the tone, for underlays that paint over scrolled content. */
export function surfaceToneCanvasColor(tone: SurfaceTone): string {
  return tone === "recessed" ? colors.threadListSurface : colors.conversationSurface;
}
