import { spacing, typeScale } from "../theme";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "./typography-policy";

export type InlineIconRole = "caption" | "label" | "body" | "title";

/** Use the same accessibility cap as text, including Android's smaller-font settings. */
export function inlineIconMetrics(role: InlineIconRole, fontScale: number) {
  const multiplier = Math.min(fontScale, APP_MAX_FONT_SIZE_MULTIPLIER);
  const typography = typeScale[role];
  return {
    glyph: (typography.fontSize + spacing.optical) * multiplier,
    slot: typography.lineHeight * multiplier,
  };
}
