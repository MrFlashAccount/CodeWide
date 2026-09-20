import { StyleSheet } from "react-native";

import { colors, radii } from "../../src/theme";
import { v1MobileRouteMotion } from "../../src/ui/v1MobileRouteMotion";

export const v1WorkspaceShellStyles = StyleSheet.create({
  desktopWorkspace: {
    backgroundColor: colors.threadListSurface,
    flex: 1,
    flexDirection: "row",
  },
  destination: {
    borderBottomLeftRadius: radii.composer,
    borderTopLeftRadius: radii.composer,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    position: "relative",
  },
  flex: { flex: 1 },
  hiddenMobileDestination: {
    bottom: 0,
    left: 0,
    minWidth: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 1,
  },
  mobileDestination: {
    bottom: 0,
    left: 0,
    minWidth: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 1,
  },
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
});

/** Stable scene geometry for every V1 destination owned by the inner workspace stack. */
export const v1RouteScreenOptions = {
  animation: "none",
  contentStyle: { backgroundColor: colors.conversationSurface },
  headerShown: false,
} as const;

/** Cross-fades peer destinations without implying hierarchy on wide layouts. */
export const v1DesktopRouteScreenOptions = {
  animation: "fade",
  contentStyle: { backgroundColor: colors.conversationSurface },
  headerShown: false,
} as const;

/** Uses the app-owned 250 ms Android crossfade resources with short horizontal travel. */
export const v1MobileRouteScreenOptions = {
  animation: "fade_from_bottom",
  animationDuration: v1MobileRouteMotion.durationMs,
  contentStyle: { backgroundColor: colors.conversationSurface },
  headerShown: false,
} as const;

/** Leaves the persistent mobile list visible when the stack resolves its empty index route. */
export const v1ListScreenOptions = {
  animation: "none",
  contentStyle: { backgroundColor: "transparent" },
  headerShown: false,
} as const;

/** Transparent presentation that keeps the owning conversation visible below a route sheet. */
export const v1SheetScreenOptions = {
  animation: "none",
  contentStyle: { backgroundColor: "transparent" },
  headerShown: false,
  presentation: "transparentModal",
} as const;

/**
 * Presents an opaque full-window workspace while keeping its owning conversation attached below.
 * Android native-stack MODAL can detach the previous Fabric screen after dismissal; an opaque
 * transparent modal keeps that screen mounted without changing the visible fullscreen result.
 */
export const v1FullscreenScreenOptions = {
  animation: "none",
  contentStyle: { backgroundColor: colors.threadListSurface },
  headerShown: false,
  presentation: "transparentModal",
} as const;
