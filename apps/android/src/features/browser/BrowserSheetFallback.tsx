import type { ReactNode } from "react";
import { View, type AccessibilityActionEvent } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Reanimated from "react-native-reanimated";
import { useEvent } from "../../react/useEvent";
import { useBrowserSheetMotion } from "./browserSheetMotion";
import { styles } from "./BrowserSheet.styles";

/** Full-width, fully opened sheet: only the grip captures drags; collapse keeps its children. */
export function BrowserSheetFallback(props: {
  readonly active: boolean;
  readonly children: ReactNode;
  readonly onCollapse: () => void;
  readonly presentationId: string;
}): React.JSX.Element {
  const motion = useBrowserSheetMotion(props);
  const accessibleCollapse = useEvent((event: AccessibilityActionEvent): void => {
    if (props.active && event.nativeEvent.actionName === "collapse") {
      props.onCollapse();
    }
  });
  return (
    <Reanimated.View
      onLayout={motion.onLayout}
      style={[styles.surface, motion.animatedStyle]}
      testID="browser-sheet"
    >
      <View style={styles.gripRail}>
        <BrowserSheetGrip gesture={motion.gesture} onCollapse={accessibleCollapse} />
      </View>
      {props.children}
    </Reanimated.View>
  );
}

function BrowserSheetGrip(props: {
  readonly gesture: ReturnType<typeof useBrowserSheetMotion>["gesture"];
  readonly onCollapse: (event: AccessibilityActionEvent) => void;
}): React.JSX.Element {
  return (
    <GestureDetector gesture={props.gesture}>
      <Reanimated.View
        accessibilityActions={[{ label: "Collapse browser", name: "collapse" }]}
        accessibilityHint="Drag down to return to the application without closing tabs"
        accessibilityLabel="Browser sheet handle"
        accessibilityRole="button"
        accessible
        onAccessibilityAction={props.onCollapse}
        style={styles.grip}
        testID="browser-sheet-handle"
      >
        <View pointerEvents="none" style={styles.gripMark} />
      </Reanimated.View>
    </GestureDetector>
  );
}
