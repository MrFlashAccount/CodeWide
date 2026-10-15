import { useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { useEvent } from "../react/useEvent";

/**
 * The laid-out width of a container that spans its parent, for content that
 * needs a numeric width (an anchored Compose menu and its trigger). The window
 * width is not the container's: a split layout gives the conversation only
 * part of it. `null` until the first layout.
 */
export function useLayoutWidth(): {
  readonly onLayout: (event: LayoutChangeEvent) => void;
  readonly width: number | null;
} {
  // WHY useState: the width belongs to the list cell's place, not its row; a
  // recycled cell keeps it, and a resized one reports a new layout.
  const [width, setWidth] = useState<number | null>(null);
  const onLayout = useEvent((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth((current) => (current === next ? current : next));
  });
  return { onLayout, width };
}
