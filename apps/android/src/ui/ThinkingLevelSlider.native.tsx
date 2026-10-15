/** The model menu's thinking level slider for any model picker. */
import type { ReactNode } from "react";

import { CodeWideSlider } from "./CodeWideSlider.native";
import { modelEffortLabel } from "./modelEffortPresentation";
import type { ThinkingLevelSliderProps } from "./ThinkingLevelSlider.types";

/** Picks one of a model's thinking levels on CodeWide's shared slider. */
export function ThinkingLevelSlider({
  levels,
  onSelect,
  selected,
  testID,
}: ThinkingLevelSliderProps): ReactNode {
  return (
    <CodeWideSlider
      accessibilityLabel="Thinking level"
      formatValue={modelEffortLabel}
      onSelect={onSelect}
      selected={selected}
      testID={testID}
      values={levels}
    />
  );
}
