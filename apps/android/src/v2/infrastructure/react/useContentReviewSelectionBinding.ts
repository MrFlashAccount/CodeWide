import { useRef, type ComponentRef, type RefObject } from "react";
import type { Text as NativeText } from "react-native";

import type { ContentReviewSelectionBindingInput } from "./contentReviewSelectionBinding";

/** Web/unsupported-platform boundary: selectable text remains usable without a native review menu. */
export function useContentReviewSelectionBinding(
  _input: ContentReviewSelectionBindingInput,
): RefObject<ComponentRef<typeof NativeText> | null> {
  return useRef<ComponentRef<typeof NativeText> | null>(null);
}
