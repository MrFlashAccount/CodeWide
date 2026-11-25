import { useContext, useLayoutEffect, type ReactNode } from "react";
import { findNodeHandle, StyleSheet, UIManager, View } from "react-native";
import { useAnimatedRef } from "react-native-reanimated";
import { useEvent } from "../react/useEvent";
import {
  PaneBodyPlacementContext,
  PaneBodySnapshotRefContext,
  usePaneBodyMode,
} from "./paneBodyTransition";
import { NativePaneSnapshot } from "./nativePaneSnapshot";
import { PaneChrome } from "./PaneChrome";
import { surfaceToneCanvasColor, useSurfaceTone } from "./surfaceTone";

/** Applies the frame's resize to reading content. Chrome and input stay live. */
export function PaneBody({
  captureAtTargetWidth = false,
  children,
  keepScrollEnd = false,
}: {
  /** The transcript captures its current pixels on the UI thread before applying its target width. */
  readonly captureAtTargetWidth?: boolean;
  readonly children: ReactNode;
  /** A single reading ScrollView keeps its bottom edge when resizing at the end of the page. */
  readonly keepScrollEnd?: boolean;
}): ReactNode {
  const mode = usePaneBodyMode();
  const placement = useContext(PaneBodyPlacementContext);
  if (mode === "live") {
    return (
      <PaneChrome retainHiddenWidth style={styles.viewport}>
        {children}
      </PaneChrome>
    );
  }
  if (mode !== "snapshot" || placement === null || NativePaneSnapshot === null) {
    return children;
  }
  return (
    <SnapshotBody
      captureAtTargetWidth={captureAtTargetWidth}
      component={NativePaneSnapshot}
      keepScrollEnd={keepScrollEnd}
      placement={placement}
    >
      {children}
    </SnapshotBody>
  );
}

function SnapshotBody({
  captureAtTargetWidth,
  children,
  component: NativeBody,
  keepScrollEnd,
  placement,
}: {
  readonly captureAtTargetWidth: boolean;
  readonly children: ReactNode;
  readonly component: NonNullable<typeof NativePaneSnapshot>;
  readonly keepScrollEnd: boolean;
  readonly placement: NonNullable<React.ContextType<typeof PaneBodyPlacementContext>>;
}): ReactNode {
  const ref = useAnimatedRef<React.ComponentRef<typeof NativeBody>>();
  const color = surfaceToneCanvasColor(useSurfaceTone());
  const capture = useEvent(() => {
    const tag = findNodeHandle(ref.current);
    if (tag !== null) {
      UIManager.dispatchViewManagerCommand(tag, "capture", []);
    }
  });
  useLayoutEffect(() => {
    if (!captureAtTargetWidth) {
      return placement.subscribeCapture(capture);
    }
    return undefined;
  }, [capture, captureAtTargetWidth, placement]);
  return (
    <PaneBodySnapshotRefContext.Provider value={ref}>
      <NativeBody
        canvasColor={color}
        keepScrollEnd={keepScrollEnd}
        ref={ref}
        style={styles.viewport}
      >
        <View collapsable={false} style={styles.content}>
          {children}
        </View>
      </NativeBody>
    </PaneBodySnapshotRefContext.Provider>
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
