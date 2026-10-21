import { controlSize, spacing } from "../../../theme";

// Average advance of the 14sp medium label face; the row reserves whole buttons, never partial ones.
const AVERAGE_LABEL_ADVANCE = 7.6;
/** A label has padding on its leading and trailing side. */
const PADDED_SIDES = 2;

/**
 * Width a catalog action button needs for its label, including its horizontal
 * padding. Filled and tonal buttons share geometry, so prominence does not change it.
 */
export function measureActionLabel(label: string): number {
  return Math.ceil(label.length * AVERAGE_LABEL_ADVANCE) + spacing.md * PADDED_SIDES;
}

/** Room the ⋯ button keeps at the end of the action row. */
export const OVERFLOW_BUTTON_WIDTH = controlSize.touch;
