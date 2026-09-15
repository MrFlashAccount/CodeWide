import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, findNodeHandle, Pressable } from "react-native";
import { setNativeVoiceAuraOrigin } from "../../native/native-transport";
import { colors, iconSize } from "../../theme";
import type { ComposerFeatureProps } from "./ComposerFeatureContract";
import { styles } from "./ComposerMicrophone.styles";
type Props = Pick<
  ComposerFeatureProps,
  | "microphoneButtonRef"
  | "editingQueuedMessage"
  | "voicePhase"
  | "voiceRetryAvailable"
  | "retryVoice"
  | "toggleVoice"
  | "finishVoice"
  | "microphoneAccess"
>;
export function ComposerMicrophone({
  microphoneButtonRef,
  editingQueuedMessage,
  voicePhase,
  voiceRetryAvailable,
  retryVoice,
  toggleVoice,
  finishVoice,
  microphoneAccess,
}: Props) {
  return (
    <Pressable
      ref={microphoneButtonRef}
      accessibilityRole="button"
      hitSlop={6}
      disabled={editingQueuedMessage || (voicePhase === "finishing" && !voiceRetryAvailable)}
      onPressIn={() => {
        if (voicePhase === "idle")
          setNativeVoiceAuraOrigin(findNodeHandle(microphoneButtonRef.current));
      }}
      onPress={() =>
        void (voiceRetryAvailable
          ? retryVoice()
          : voicePhase === "idle"
            ? toggleVoice()
            : finishVoice(false))
      }
      style={[
        styles.composerIcon,
        (editingQueuedMessage ||
          (voicePhase === "idle" && !microphoneAccess.granted && !voiceRetryAvailable) ||
          (voicePhase === "finishing" && !voiceRetryAvailable)) &&
          styles.disabled,
      ]}
      accessibilityLabel={
        voiceRetryAvailable
          ? "Retry voice transcription"
          : voicePhase === "idle"
            ? microphoneAccess.granted
              ? "Voice input"
              : "Allow microphone access"
            : "Stop voice input and insert transcript"
      }
    >
      {voicePhase === "starting" ? (
        <ActivityIndicator size="small" color={colors.textMuted} />
      ) : (
        <Ionicons
          name={
            voiceRetryAvailable ? "refresh" : voicePhase === "idle" ? "mic-outline" : "stop-circle"
          }
          size={iconSize.action}
          color={voiceRetryAvailable || voicePhase === "idle" ? colors.text : colors.red}
        />
      )}
    </Pressable>
  );
}
