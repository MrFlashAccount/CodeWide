import { formatVoiceDuration } from "./voicePresentation";
/** V1 VoiceCaptureStatus owner, extracted without changing interaction or resource lifetime. */
import { ActivityIndicator, View } from "react-native";
import { useSecondClock } from "../../../data/second-clock";
import type { VoiceInputController } from "../../../data/voice-input-controller";
import type { VoiceInputRow } from "../../../data/workspace-resource-database";
import { colors } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { useVoiceInputLevel } from "../../../ui/VoiceInputRuntime";
import { styles } from "./VoiceCaptureStatus.styles";

export function VoiceCaptureStatus({
  backend,
  controller,
  phase,
  scope,
  startedAt,
}: {
  backend: VoiceInputRow["backend"];
  controller: VoiceInputController | null;
  phase: VoiceInputRow["phase"];
  scope: string;
  startedAt: number;
}) {
  const level = useVoiceInputLevel(controller, phase === "recording" ? scope : null);
  const clock = useSecondClock(phase === "recording");

  const elapsedSeconds =
    phase === "recording"
      ? Math.max(0, Math.floor((Math.max(startedAt, clock) - startedAt) / 1000))
      : 0;

  return (
    <View accessibilityLabel="Voice recording" style={styles.voiceCapture}>
      {phase === "recording" ? (
        <View style={styles.voiceMeter}>
          {[0.55, 0.8, 1, 0.72, 0.45].map((weight) => (
            <View
              key={weight}
              style={[styles.voiceMeterBar, { height: 5 + Math.max(0.12, level) * weight * 18 }]}
            />
          ))}
        </View>
      ) : (
        <ActivityIndicator color={colors.accent} size="small" />
      )}
      <Text numberOfLines={1} style={styles.voiceCaptureLabel}>
        {phase === "finishing"
          ? "Transcribing…"
          : `${backend === "android" ? "Android · " : ""}${formatVoiceDuration(elapsedSeconds)}`}
      </Text>
    </View>
  );
}
