import { useState } from "react";
import type { LayoutChangeEvent } from "react-native";

import { useWindowLayout } from "../features/workspace/useWindowLayout";
import { V1_TWO_PANE_MIN_WIDTH } from "../native/window-layout";
import { useEvent } from "../react/useEvent";

/** Seeds navigation from window metrics, then sizes all routes from their mounted workspace. */
export function useWorkspaceViewport(): {
  readonly desktop: boolean;
  readonly onWorkspaceLayout: (event: LayoutChangeEvent) => void;
  readonly viewportWidth: number;
} {
  const windowLayout = useWindowLayout();
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const viewportWidth = measuredWidth ?? windowLayout.width;
  const onWorkspaceLayout = useEvent((event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    if (Number.isFinite(width) && width > 0) {
      setMeasuredWidth(width);
    }
  });
  return { desktop: viewportWidth >= V1_TWO_PANE_MIN_WIDTH, onWorkspaceLayout, viewportWidth };
}
