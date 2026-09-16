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
  editingQueuedMessage,
  finishVoice,
  microphoneAccess,
  microphoneButtonRef,
  retryVoice,
  toggleVoice,
  voicePhase,
  voiceRetryAvailable,
}: Props) {
  return (
    <Pressable
      accessibilityLabel={
        voiceRetryAvailable
          ? "Retry voice transcription"
          : voicePhase === "idle"
            ? microphoneAccess.granted
              ? "Voice input"
              : "Allow microphone access"
            : "Stop voice input and insert transcript"
      }
      accessibilityRole="button"
      disabled={editingQueuedMessage || (voicePhase === "finishing" && !voiceRetryAvailable)}
      hitSlop={6}
      onPress={() =>
        void (voiceRetryAvailable
          ? retryVoice()
          : voicePhase === "idle"
            ? toggleVoice()
            : finishVoice(false))
      }
      onPressIn={() => {
        if (voicePhase === "idle") {
          setNativeVoiceAuraOrigin(findNodeHandle(microphoneButtonRef.current));
        }
      }}
      ref={microphoneButtonRef}
      style={[
        styles.composerIcon,
        (editingQueuedMessage ||
          (voicePhase === "idle" && !microphoneAccess.granted && !voiceRetryAvailable) ||
          (voicePhase === "finishing" && !voiceRetryAvailable)) &&
          styles.disabled,
      ]}
    >
      {voicePhase === "starting" ? (
        <ActivityIndicator color={colors.textMuted} size="small" />
      ) : (
        <Ionicons
          color={voiceRetryAvailable || voicePhase === "idle" ? colors.text : colors.red}
          name={
            voiceRetryAvailable ? "refresh" : voicePhase === "idle" ? "mic-outline" : "stop-circle"
          }
          size={iconSize.action}
        />
      )}
    </Pressable>
  );
}
