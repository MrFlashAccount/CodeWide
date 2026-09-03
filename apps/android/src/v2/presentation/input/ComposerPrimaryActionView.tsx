import { Pressable, type PressableStateCallbackType, StyleSheet } from "react-native";

import { colors, radii, touchTarget, typeScale } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ShimmerText } from "../text/ShimmerText";

export type ComposerPrimaryActionMode = "send" | "stop";

interface ComposerPrimaryActionViewProps {
  disabled: boolean;
  mode: ComposerPrimaryActionMode;
  onPress(): void;
  pending: boolean;
  voiceActive: boolean;
  voiceFinishing: boolean;
  voiceStarting: boolean;
}

/** Renders the composer's send/stop control while its feature owner runs the action. */
export function ComposerPrimaryActionView(
  props: ComposerPrimaryActionViewProps,
): React.JSX.Element {
  const { disabled, mode, onPress, pending, voiceActive, voiceFinishing, voiceStarting } = props;
  const stopping = mode === "stop" && !voiceActive;
  return (
    <Pressable
      accessibilityLabel={
        voiceActive
          ? "Finish voice input and send transcript"
          : stopping
            ? "Stop response"
            : "Send message"
      }
      accessibilityRole="button"
      accessibilityState={{ busy: pending || voiceStarting || voiceFinishing, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={disabled ? disabledActionStyle : stopping ? stopActionStyle : sendActionStyle}
    >
      {voiceFinishing ? (
        <PresentationIcon color={colors.onPrimary} name="hourglass" size={21} />
      ) : pending ? (
        <ShimmerText
          style={styles.progress}
          text={stopping ? "Stop" : "Send"}
          widthPolicy="intrinsic"
        />
      ) : (
        <PresentationIcon color={colors.onPrimary} name={stopping ? "stop" : "send"} size={21} />
      )}
    </Pressable>
  );
}

function disabledActionStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.action, styles.disabled, pressed && styles.sendPressed];
}

function sendActionStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.action, pressed && styles.sendPressed];
}

function stopActionStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.action, styles.stop, pressed && styles.stopPressed];
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.composer,
    flexShrink: 0,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  disabled: { opacity: 0.45 },
  progress: { color: colors.onPrimary, ...typeScale.caption },
  sendPressed: { backgroundColor: colors.primaryPressed },
  stop: { backgroundColor: colors.red },
  stopPressed: { opacity: 0.82 },
});
