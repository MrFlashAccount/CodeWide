import { StyleSheet, View, type ViewStyle } from "react-native";

import { colors, radii, spacing } from "../../theme";

interface VoiceLevelMeterProps {
  level: number;
}

/** Isolates high-frequency microphone level renders from the surrounding composer. */
export function VoiceLevelMeter(props: VoiceLevelMeterProps): React.JSX.Element {
  const { level } = props;
  const bounded = boundedLevel(level);
  return (
    <View
      accessibilityLabel="Voice input level"
      accessibilityRole="progressbar"
      accessibilityValue={{ max: 100, min: 0, now: Math.round(bounded * 100) }}
      style={styles.track}
    >
      <View style={[styles.fill, levelFillStyle(bounded)]} />
    </View>
  );
}

function boundedLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(1, level));
}

function levelFillStyle(level: number): ViewStyle {
  return { width: `${Math.round(level * 100)}%` };
}

const styles = StyleSheet.create({
  fill: {
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    height: "100%",
  },
  track: {
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: radii.pill,
    height: spacing.xs,
    overflow: "hidden",
  },
});
