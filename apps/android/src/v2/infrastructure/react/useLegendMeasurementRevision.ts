import type { LegendListRef } from "@legendapp/list/react-native";
import { useLayoutEffect, type RefObject } from "react";

/** Invalidates cached row sizes after a fold, rotation, or font-scale change. */
export function useLegendMeasurementRevision(
  listRef: RefObject<LegendListRef | null>,
  measurementRevision: string,
): void {
  useLayoutEffect(() => {
    listRef.current?.clearCaches({ mode: "sizes" });
  }, [listRef, measurementRevision]);
}
