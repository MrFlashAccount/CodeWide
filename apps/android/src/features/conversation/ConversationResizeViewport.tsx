import { useContext, type ReactNode } from "react";
import type { LayoutChangeEvent, ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  dispatchCommand,
  measure,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { PaneBodyPlacementContext, PaneBodySnapshotRefContext } from "../../ui/paneBodyTransition";
import { useReducedMotionPreference } from "../../rendering/reduced-motion-store";
import { styles } from "./ConversationLayout.styles";

// A brief pause in a drag gives the reader the actual layout at the held position.
const REFLOW_QUIET_MS = 80;
const REST = { kind: "rest" } as const;

/** Keeps the transcript at its last displayed width while the divider moves. */
export function ConversationResizeViewport({
  children,
  onLayout,
}: {
  readonly children: ReactNode;
  readonly onLayout: (event: LayoutChangeEvent) => void;
}): React.JSX.Element {
  const placement = useContext(PaneBodyPlacementContext);
  const snapshotRef = useContext(PaneBodySnapshotRefContext);
  const readingWidth = placement?.readingWidth;
  const reducedMotion = useReducedMotionPreference();
  const snapshot = reducedMotion ? null : snapshotRef;
  const ref = useAnimatedRef<Animated.View>();
  const contentWidth = useSharedValue(0);
  function holdDisplayedWidth(fallback: number): void {
    "worklet";
    if (snapshot !== null) {
      dispatchCommand(snapshot, "cancelReflow", []);
    }
    contentWidth.set(measure(ref)?.width ?? fallback);
  }
  useAnimatedReaction(
    () => readingWidth?.get() ?? REST,
    (next, previous) => {
      cancelAnimation(contentWidth);
      if (next.kind === "rest") {
        contentWidth.set(0);
        return;
      }
      if (next.kind === "landing") {
        if (snapshot !== null) {
          dispatchCommand(snapshot, "captureReflow", [next.width]);
        }
        contentWidth.set(next.width);
        return;
      }
      if (previous?.kind !== "drag") {
        holdDisplayedWidth(next.width);
      }
      contentWidth.set(
        withDelay(REFLOW_QUIET_MS, withTiming(next.width, { duration: 0 }), ReduceMotion.Never),
      );
    },
  );
  const size = useAnimatedStyle<ViewStyle>(() => {
    const width = contentWidth.get();
    return { width: width > 0 ? width : "100%" };
  });
  return (
    <Animated.View onLayout={onLayout} ref={ref} style={[styles.conversationContentSurface, size]}>
      {children}
    </Animated.View>
  );
}
