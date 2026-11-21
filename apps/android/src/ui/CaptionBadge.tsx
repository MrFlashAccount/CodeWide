import { StyleSheet, View, type TextStyle, type ViewStyle } from "react-native";

import { colors, radii, spacing, typeScale } from "../theme";
import { AppText as Text } from "./Typography";

/** Semantic tone; color is always paired with a glyph or a word in the label. */
export type CaptionBadgeTone = "danger" | "neutral" | "success" | "warning";

const GLYPHS: Readonly<Record<CaptionBadgeTone, string>> = {
  danger: "✕ ",
  neutral: "",
  success: "✓ ",
  warning: "● ",
};

/**
 * Compact outlined badge in the caption role (N-05/N-06): one line, never
 * wraps; semantic tones prefix a glyph so color is never the only signal.
 */
export function CaptionBadge({
  label,
  testID,
  tone = "neutral",
}: {
  readonly label: string;
  readonly testID?: string;
  readonly tone?: CaptionBadgeTone;
}): React.JSX.Element {
  return (
    <View style={[styles.badge, toneBorders[tone]]} testID={testID}>
      <Text numberOfLines={1} style={[styles.label, toneLabels[tone]]}>
        {`${GLYPHS[tone]}${label}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radii.compact,
    borderWidth: 1,
    flexShrink: 0,
    paddingHorizontal: spacing.compact,
    paddingVertical: spacing.optical,
  },
  danger: {
    borderColor: colors.error,
  },
  dangerLabel: {
    color: colors.error,
  },
  label: {
    ...typeScale.caption,
    color: colors.textMuted,
  },
  neutral: {
    borderColor: colors.border,
  },
  neutralLabel: {
    color: colors.textMuted,
  },
  success: {
    borderColor: colors.success,
  },
  successLabel: {
    color: colors.success,
  },
  warning: {
    borderColor: colors.warning,
  },
  warningLabel: {
    color: colors.warning,
  },
});

const toneBorders: Readonly<Record<CaptionBadgeTone, ViewStyle>> = {
  danger: styles.danger,
  neutral: styles.neutral,
  success: styles.success,
  warning: styles.warning,
};

const toneLabels: Readonly<Record<CaptionBadgeTone, TextStyle>> = {
  danger: styles.dangerLabel,
  neutral: styles.neutralLabel,
  success: styles.successLabel,
  warning: styles.warningLabel,
};
