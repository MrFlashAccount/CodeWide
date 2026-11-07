import { Ionicons } from "@expo/vector-icons";
import type { RefObject } from "react";
import { ActivityIndicator, findNodeHandle, Pressable, type View } from "react-native";
import { setNativeVoiceAuraOrigin } from "../../native/native-transport";
import { colors, iconSize } from "../../theme";
import { styles } from "./ComposerMicrophone.styles";

/**
 * The composer's microphone control over one retained voice input. It owns no
 * recording state: the caller binds its own input scope and supplies the phase
 * and actions, so the chat composer and the review line composer share it.
 */
export type ComposerMicrophoneProps = {
  /** The owning input cannot record right now (for example a queued message is being edited). */
  readonly disabled: boolean;
  /** Stops the recording and inserts its transcript (`false`) or sends it (`true`). */
  readonly finishVoice: (sendAfter: boolean) => Promise<void>;
  readonly microphoneAccess: { readonly allowCapture: () => boolean; readonly granted: boolean };
  readonly microphoneButtonRef: RefObject<View | null>;
  readonly retryVoice: () => Promise<void>;
  readonly toggleVoice: () => Promise<void>;
  /** Another input owns the microphone and the hand-off policy forbids taking it. */
  readonly voiceDisabled: boolean;
  readonly voicePhase: "idle" | "starting" | "recording" | "finishing";
  readonly voiceRetryAvailable: boolean;
};

export function ComposerMicrophone({
  disabled,
  finishVoice,
  microphoneAccess,
  microphoneButtonRef,
  retryVoice,
  toggleVoice,
  voiceDisabled,
  voicePhase,
  voiceRetryAvailable,
}: ComposerMicrophoneProps) {
  const handoffDisabled = voiceDisabled && voicePhase === "idle" && !voiceRetryAvailable;
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
      disabled={disabled || handoffDisabled || (voicePhase === "finishing" && !voiceRetryAvailable)}
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
        (disabled ||
          handoffDisabled ||
          (voicePhase === "idle" && !microphoneAccess.granted && !voiceRetryAvailable) ||
          (voicePhase === "finishing" && !voiceRetryAvailable)) &&
          styles.disabled,
      ]}
      testID="composer-microphone"
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
