import { useState } from "react";
import { PanResponder, type LayoutChangeEvent } from "react-native";
import { useEvent } from "../../react/useEvent";
import { percentageDimension } from "../../ui/percentageDimension";
import type { DevToolsDockSide } from "./devToolsMessage";
import { styles } from "./InternalBrowser.styles";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
export function useBrowserPaneLayout(devToolsDockSide: DevToolsDockSide, devToolsOpen: boolean) {
  const [targetPaneFraction, setTargetPaneFraction] = useState(0.5);
  const [contentSize, setContentSize] = useState({ height: 0, width: 0 });
  const dividerPanResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => {
      const delta =
        devToolsDockSide === "left" || devToolsDockSide === "right" ? gesture.dx : gesture.dy;
      return Math.abs(delta) > 2;
    },
    onPanResponderMove: (_event, gesture) => {
      const vertical = devToolsDockSide === "left" || devToolsDockSide === "right";
      const axisSize = vertical ? contentSize.width : contentSize.height;
      if (axisSize <= 0) {
        return;
      }
      const delta = vertical ? gesture.dx : gesture.dy;
      const direction = devToolsDockSide === "left" ? -1 : 1;
      const next = clamp(targetPaneFraction + (direction * delta) / axisSize, 0.2, 0.8);
      setTargetPaneFraction(next);
    },
    onStartShouldSetPanResponder: () => true,
  });
  const onContentLayout = useEvent((event: LayoutChangeEvent) => {
    const { height, width } = event.nativeEvent.layout;
    setContentSize({ height, width });
  });
  const verticalDock = devToolsDockSide === "left" || devToolsDockSide === "right";
  const fraction = percentageDimension(targetPaneFraction * 100);
  const targetPaneStyle = devToolsOpen
    ? devToolsDockSide === "undocked"
      ? [styles.targetPane, styles.targetPaneUndocked]
      : [styles.targetPane, verticalDock ? { width: fraction } : { height: fraction }]
    : styles.targetPaneClosed;
  return { dividerPanResponder, onContentLayout, targetPaneStyle, verticalDock };
}
