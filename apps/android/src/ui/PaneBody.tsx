import { useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import { findNodeHandle, StyleSheet, UIManager } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useEvent } from "../react/useEvent";
import { PaneBodyPlacementContext, usePaneBodyMode } from "./paneBodyTransition";
import { NativePaneSnapshot } from "./nativePaneSnapshot";
import { PaneChrome } from "./PaneChrome";
import { surfaceToneCanvasColor, useSurfaceTone } from "./surfaceTone";

/** Applies the frame's resize to reading content. Chrome and input stay live. */
export function PaneBody({
  children,
  keepScrollEnd = false,
}: {
  readonly children: ReactNode;
  /** A single reading ScrollView keeps its bottom edge when resizing at the end of the page. */
  readonly keepScrollEnd?: boolean;
}): ReactNode {
  const mode = usePaneBodyMode();
  const placement = useContext(PaneBodyPlacementContext);
  if (mode === "fixed") {
    return children;
  }
  return (
    <PaneChrome retainHiddenWidth style={styles.viewport}>
      {mode === "snapshot" && placement !== null && NativePaneSnapshot !== null ? (
        <SnapshotBody
          component={NativePaneSnapshot}
          keepScrollEnd={keepScrollEnd}
          placement={placement}
        >
          {children}
        </SnapshotBody>
      ) : (
        children
      )}
    </PaneChrome>
  );
}

function SnapshotBody({
  children,
  component: NativeBody,
  keepScrollEnd,
  placement,
}: {
  readonly children: ReactNode;
  readonly component: NonNullable<typeof NativePaneSnapshot>;
  readonly keepScrollEnd: boolean;
  readonly placement: NonNullable<React.ContextType<typeof PaneBodyPlacementContext>>;
}): ReactNode {
  const ref = useRef<React.ComponentRef<typeof NativeBody>>(null);
  const color = surfaceToneCanvasColor(useSurfaceTone());
  const capture = useEvent(() => {
    const tag = findNodeHandle(ref.current);
    if (tag !== null) {
      UIManager.dispatchViewManagerCommand(tag, "capture", []);
    }
  });
  useLayoutEffect(() => placement.subscribeCapture(capture), [capture, placement]);
  const { finalMargin } = placement;
  const final = useAnimatedStyle(() => ({ marginRight: finalMargin.get() }));
  return (
    <NativeBody canvasColor={color} keepScrollEnd={keepScrollEnd} ref={ref} style={styles.viewport}>
      <Animated.View collapsable={false} style={[styles.content, final]}>
        {children}
      </Animated.View>
    </NativeBody>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    minWidth: 0,
  },
  viewport: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
  },
});
