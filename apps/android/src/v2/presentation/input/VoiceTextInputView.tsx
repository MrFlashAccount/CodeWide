import type { ComponentProps } from "react";
import {
  Pressable,
  type PressableStateCallbackType,
  StyleSheet,
  type StyleProp,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, typeScale } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { PresentationTextInput } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";

export interface VoiceTextInputControl {
  activate(): Promise<void>;
  disabled: boolean;
  state: "error" | "finishing" | "idle" | "recording" | "retry" | "starting";
}

export interface VoiceTextInputViewProps extends ComponentProps<typeof PresentationTextInput> {
  containerStyle?: StyleProp<ViewStyle>;
  onVoiceFailure?(): void;
  voice: VoiceTextInputControl;
}

/** Renders an input-owned Voice action without owning capture or transcript state. */
export function VoiceTextInputView(props: VoiceTextInputViewProps): React.JSX.Element {
  const { containerStyle, onVoiceFailure, style, voice, ...inputProps } = props;
  const activate = useEvent(() => {
    if (voice.disabled) return;
    voice.activate().catch(() => onVoiceFailure?.());
  });
  return (
    <View style={[voiceInputContainerStyle(style), containerStyle]}>
      <PresentationTextInput {...inputProps} style={voiceInputTextStyle(style)} />
      <Pressable
        accessibilityLabel={voiceAccessibilityLabel(voice.state)}
        accessibilityRole="button"
        accessibilityState={{
          busy: voice.state === "starting" || voice.state === "finishing",
          disabled: voice.disabled,
        }}
        disabled={voice.disabled}
        hitSlop={4}
        onPress={activate}
        style={voice.disabled ? disabledButtonStyle : enabledButtonStyle}
      >
        {voice.state === "starting" || voice.state === "finishing" ? (
          <ShimmerText style={styles.progress} text="•••" />
        ) : (
          <PresentationIcon
            color={
              voice.state === "recording" || voice.state === "retry" || voice.state === "error"
                ? colors.red
                : colors.textMuted
            }
            name={voiceIcon(voice.state)}
            size={19}
          />
        )}
      </Pressable>
    </View>
  );
}

function disabledButtonStyle(state: PressableStateCallbackType) {
  return [styles.button, state.pressed && styles.buttonPressed, styles.disabled];
}

function enabledButtonStyle(state: PressableStateCallbackType) {
  return [styles.button, state.pressed && styles.buttonPressed];
}

function voiceAccessibilityLabel(state: VoiceTextInputControl["state"]): string {
  if (state === "retry") return "Retry voice input";
  if (state === "idle" || state === "error") return "Voice input";
  return "Stop voice input";
}

function voiceIcon(state: VoiceTextInputControl["state"]): "mic" | "refresh" | "stop" {
  if (state === "retry") return "refresh";
  return state === "recording" ? "stop" : "mic";
}

const INPUT_LAYOUT_KEYS: ReadonlyArray<keyof ViewStyle> = [
  "alignSelf",
  "bottom",
  "end",
  "flex",
  "flexBasis",
  "flexGrow",
  "flexShrink",
  "height",
  "left",
  "margin",
  "marginBottom",
  "marginEnd",
  "marginHorizontal",
  "marginLeft",
  "marginRight",
  "marginStart",
  "marginTop",
  "marginVertical",
  "maxHeight",
  "maxWidth",
  "minHeight",
  "minWidth",
  "position",
  "right",
  "start",
  "top",
  "width",
  "zIndex",
];
const INPUT_LAYOUT_KEY_SET = new Set<string>(INPUT_LAYOUT_KEYS);

function voiceInputContainerStyle(style: StyleProp<TextStyle>): StyleProp<ViewStyle> {
  const flattened = StyleSheet.flatten(style) ?? {};
  const layout: ViewStyle = { minHeight: 40 };
  for (const key of INPUT_LAYOUT_KEYS) {
    const value = flattened[key as keyof typeof flattened];
    if (value !== undefined) Object.assign(layout, { [key]: value });
  }
  return layout;
}

function voiceInputTextStyle(style: StyleProp<TextStyle>): StyleProp<TextStyle> {
  const flattened = StyleSheet.flatten(style) ?? {};
  const inputStyle: TextStyle = {};
  for (const [key, value] of Object.entries(flattened)) {
    if (!INPUT_LAYOUT_KEY_SET.has(key)) Object.assign(inputStyle, { [key]: value });
  }
  const currentRightPadding =
    typeof flattened.paddingRight === "number"
      ? flattened.paddingRight
      : typeof flattened.paddingHorizontal === "number"
        ? flattened.paddingHorizontal
        : typeof flattened.padding === "number"
          ? flattened.padding
          : 0;
  return [inputStyle, styles.input, { paddingRight: Math.max(currentRightPadding, 44) }];
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: 20,
    bottom: 2,
    height: 40,
    justifyContent: "center",
    position: "absolute",
    right: 2,
    width: 40,
  },
  buttonPressed: { backgroundColor: colors.surfaceContainerHighest },
  disabled: { opacity: 0.45 },
  input: { flex: 1, minHeight: 40, minWidth: 0, width: "100%" },
  progress: { color: colors.accent, ...typeScale.label },
});
