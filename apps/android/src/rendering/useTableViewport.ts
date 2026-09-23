import { useState } from "react";
import type { LayoutChangeEvent } from "react-native";

import { useEvent } from "../react/useEvent";
import { useRichContentWidth } from "./RichContentLayout";

/** Parent allocation sizes the viewport; its measurement sizes only the scrollable columns. */
export function useTableViewport(): {
  readonly contentWidth: number;
  readonly onLayout: (event: LayoutChangeEvent) => void;
  readonly width: number | "100%";
} {
  const providedWidth = useRichContentWidth();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const onLayout = useEvent((event: LayoutChangeEvent) => {
    setMeasuredWidth(Math.ceil(event.nativeEvent.layout.width));
  });
  const allocation = providedWidth !== null && providedWidth > 0 ? providedWidth : null;
  // Never feed a measured width back into this element: a transient narrow
  // rotation allocation would become permanent until the table unmounts.
  return {
    contentWidth: allocation ?? measuredWidth,
    onLayout,
    width: allocation ?? ("100%" as const),
  };
}
