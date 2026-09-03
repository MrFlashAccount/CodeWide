import { StyleSheet, View } from "react-native";

import { colors, spacing, touchTarget, typeScale } from "../../theme";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";

type VoiceCaptureStatus = "starting" | "recording" | "finishing" | "cancelling" | "retry";

interface VoiceCaptureStatusViewProps {
  elapsedSeconds: number;
  level: number;
  message: string | null;
  state: VoiceCaptureStatus;
}

const VOICE_METER_WEIGHTS = [
  { id: "outer-left", weight: 0.55 },
  { id: "inner-left", weight: 0.8 },
  { id: "center", weight: 1 },
  { id: "inner-right", weight: 0.72 },
  { id: "outer-right", weight: 0.45 },
] as const;

export function VoiceCaptureStatusView(props: VoiceCaptureStatusViewProps): React.JSX.Element {
  const { elapsedSeconds, level, message, state } = props;
  const recording = state === "recording";
  return (
    <View accessibilityLabel="Voice recording" style={styles.status}>
      {recording ? (
        <View accessibilityLabel="Voice input level" style={styles.meter}>
          {VOICE_METER_WEIGHTS.map((meter) => (
            <View
              key={meter.id}
              testID="v2-voice-meter-bar"
              style={[styles.meterBar, { height: 5 + Math.max(0.12, level) * meter.weight * 18 }]}
            />
          ))}
        </View>
      ) : (
        <ShimmerText style={styles.progress} text="•••" />
      )}
      <ProductText numberOfLines={1} style={styles.label}>
        {voiceStatusLabel(state, elapsedSeconds, message)}
      </ProductText>
    </View>
  );
}

function voiceStatusLabel(
  state: VoiceCaptureStatus,
  elapsedSeconds: number,
  message: string | null,
): string {
  if (state === "starting") return "Connecting…";
  if (state === "retry") return message ?? "Transcribing…";
  if (state === "finishing") return "Transcribing…";
  if (state === "cancelling") return message ?? "Cancelling voice…";
  return formatVoiceDuration(elapsedSeconds);
}

function formatVoiceDuration(seconds: number): string {
  const normalized = Math.max(0, Math.floor(seconds));
  return `${Math.floor(normalized / 60)}:${String(normalized % 60).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  label: { color: colors.textMuted, ...typeScale.voiceLabel, fontVariant: ["tabular-nums"] },
  meter: { alignItems: "center", flexDirection: "row", gap: spacing.meter, height: 26 },
  meterBar: {
    backgroundColor: colors.accent,
    borderRadius: spacing.optical,
    maxHeight: spacing.lg,
    minHeight: spacing.xxs,
    width: spacing.meter,
  },
  progress: { color: colors.accent, ...typeScale.label },
  status: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: touchTarget,
    minWidth: 0,
    paddingLeft: spacing.sm,
    paddingVertical: spacing.xxs,
  },
});
