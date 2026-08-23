import { Ionicons } from "@expo/vector-icons";
import { forwardRef, useEffectEvent, useId, useLayoutEffect, useRef, type ComponentProps, type ForwardedRef } from "react";
import {
  ActivityIndicator,
  findNodeHandle,
  Pressable,
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type StyleProp,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";

import { installLargePasteInterceptor, type LargePasteEvent } from "../native/large-paste";
import { colors } from "../theme";
import { productFonts } from "./product-fonts";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "./typography-policy";
import { useAppVoiceInputRuntime, useVoiceInputResource } from "./VoiceInputRuntime";
import { shouldEnableVoiceInput } from "./voice-input-policy";

export function productFontStyle(style: StyleProp<TextStyle>): TextStyle | null {
  const flattened = StyleSheet.flatten(style);
  if (flattened?.fontFamily !== undefined) return null;

  const rawWeight = flattened?.fontWeight;
  const weight = rawWeight === "bold" ? 700 : Number.parseInt(String(rawWeight ?? 400), 10);
  const fontFamily = weight <= 400
    ? productFonts.regular
    : weight <= 500
      ? productFonts.medium
      : productFonts.semibold;

  return { fontFamily, fontWeight: "400" };
}

export function AppText({ style, allowFontScaling = true, maxFontSizeMultiplier = APP_MAX_FONT_SIZE_MULTIPLIER, ...props }: ComponentProps<typeof NativeText>) {
  return (
    <NativeText
      {...props}
      allowFontScaling={allowFontScaling}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[style, productFontStyle(style)]}
    />
  );
}

export type AppTextInputProps = ComponentProps<typeof NativeTextInput> & {
  /** Natural-language fields enable voice input by default. */
  voiceInput?: boolean;
  /** Stable semantic scope for composite inputs that render voice state elsewhere. */
  voiceScope?: string;
  /** Consume clipboard text above this limit before Android chunks the paste. */
  largePasteThreshold?: number;
  onLargePaste?(event: LargePasteEvent): void;
};

export const AppTextInput = forwardRef<NativeTextInput, AppTextInputProps>(function AppTextInput({
  style,
  voiceInput,
  voiceScope,
  largePasteThreshold,
  onLargePaste,
  value,
  defaultValue,
  editable,
  secureTextEntry,
  keyboardType,
  inputMode,
  allowFontScaling = true,
  maxFontSizeMultiplier = APP_MAX_FONT_SIZE_MULTIPLIER,
  selection,
  onChangeText,
  onSelectionChange,
  ...props
}, forwardedRef) {
  const runtime = useAppVoiceInputRuntime();
  const generatedId = useId();
  const inputRef = useRef<NativeTextInput | null>(null);
  const uncontrolledValueRef = useRef(defaultValue ?? "");
  const selectionRef = useRef<{ start: number; end: number } | null>(selection === undefined
    ? null
    : { start: selection.start, end: selection.end ?? selection.start });
  const enabled = runtime?.controller !== null && runtime?.controller !== undefined && shouldEnableVoiceInput({
    ...(voiceInput === undefined ? {} : { voiceInput }),
    ...(editable === undefined ? {} : { editable }),
    ...(secureTextEntry === undefined ? {} : { secureTextEntry }),
    ...(keyboardType === undefined ? {} : { keyboardType }),
    ...(inputMode === undefined ? {} : { inputMode }),
  });
  const scope = enabled ? voiceScope ?? `${runtime.scopePrefix}\u0000input\u0000${generatedId}` : null;
  const voice = useVoiceInputResource(runtime, scope);
  const voicePhase = voice?.phase ?? "idle";
  const retryAvailable = voice?.retryAvailable ?? false;
  const pendingSelection = voice?.pendingSelection ?? null;
  const currentValue = () => typeof value === "string" ? value : uncontrolledValueRef.current;
  const updateValue = (next: string) => {
    uncontrolledValueRef.current = next;
    if (typeof value !== "string") inputRef.current?.setNativeProps({ text: next });
    onChangeText?.(next);
  };
  const currentSelection = () => selectionRef.current ?? { start: currentValue().length, end: currentValue().length };
  const bindVoice = () => {
    if (runtime?.controller === null || runtime?.controller === undefined || scope === null) return;
    runtime.controller.bind({
      scope,
      source: currentValue,
      selection: currentSelection,
      thread: runtime.thread,
      updateDraft: updateValue,
      send: updateValue,
      ...(runtime.startRemote === undefined ? {} : { startRemote: runtime.startRemote }),
    });
  };
  const pressVoice = async () => {
    if (runtime?.controller === null || runtime?.controller === undefined || scope === null) return;
    inputRef.current?.focus();
    bindVoice();
    if (retryAvailable) await runtime.controller.retry();
    else if (voicePhase === "idle") await runtime.controller.toggle();
    else if (voicePhase !== "finishing") await runtime.controller.finish(false);
  };
  const setInputRef = (node: NativeTextInput | null) => {
    inputRef.current = node;
    assignForwardedRef(forwardedRef, node);
  };
  const handleLargePaste = useEffectEvent((event: LargePasteEvent) => onLargePaste?.(event));
  const largePasteToken = `large-paste-${generatedId}`;
  const largePasteEnabled = onLargePaste !== undefined && largePasteThreshold !== undefined;
  useLayoutEffect(() => {
    if (!largePasteEnabled || largePasteThreshold === undefined) return;
    const reactTag = findNodeHandle(inputRef.current);
    if (reactTag === null) return;
    return installLargePasteInterceptor(reactTag, largePasteToken, largePasteThreshold, handleLargePaste) ?? undefined;
  }, [largePasteEnabled, largePasteThreshold, largePasteToken]);
  const handleChangeText = (next: string) => {
    uncontrolledValueRef.current = next;
    onChangeText?.(next);
  };
  const handleSelectionChange: NonNullable<ComponentProps<typeof NativeTextInput>["onSelectionChange"]> = (event) => {
    selectionRef.current = event.nativeEvent.selection;
    onSelectionChange?.(event);
    if (
      scope !== null
      && pendingSelection !== null
      && pendingSelection.start === event.nativeEvent.selection.start
      && pendingSelection.end === event.nativeEvent.selection.end
    ) runtime?.controller?.clearPendingSelection(scope);
  };
  const input = (
    <NativeTextInput
      ref={setInputRef}
      {...props}
      value={value}
      defaultValue={defaultValue}
      editable={editable}
      secureTextEntry={secureTextEntry}
      keyboardType={keyboardType}
      inputMode={inputMode}
      allowFontScaling={allowFontScaling}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      selection={pendingSelection ?? selection}
      onChangeText={handleChangeText}
      onSelectionChange={handleSelectionChange}
      style={enabled ? voiceInputTextStyle(style) : [style, productFontStyle(style)]}
    />
  );
  if (!enabled) return input;
  return (
    <View style={voiceInputContainerStyle(style)}>
      {input}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={retryAvailable ? "Retry voice input" : voicePhase === "idle" ? "Voice input" : "Stop voice input"}
        disabled={voicePhase === "finishing" && !retryAvailable}
        hitSlop={4}
        onPress={() => void pressVoice()}
        style={({ pressed }) => [voiceStyles.button, pressed && voiceStyles.buttonPressed, voicePhase === "finishing" && !retryAvailable && voiceStyles.buttonDisabled]}
      >
        {voicePhase === "starting" || (voicePhase === "finishing" && !retryAvailable)
          ? <ActivityIndicator size="small" color={colors.accent} />
          : <Ionicons name={retryAvailable ? "refresh" : voicePhase === "idle" ? "mic-outline" : "stop"} size={19} color={voicePhase === "recording" ? colors.red : voice?.error === null || voice?.error === undefined ? colors.textMuted : colors.red} />}
      </Pressable>
    </View>
  );
});

const INPUT_LAYOUT_KEYS: ReadonlyArray<keyof ViewStyle> = [
  "alignSelf", "bottom", "end", "flex", "flexBasis", "flexGrow", "flexShrink", "height", "left",
  "margin", "marginBottom", "marginEnd", "marginHorizontal", "marginLeft", "marginRight", "marginStart",
  "marginTop", "marginVertical", "maxHeight", "maxWidth", "minHeight", "minWidth", "position", "right",
  "start", "top", "width", "zIndex",
];

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
  const flattened = { ...(StyleSheet.flatten(style) ?? {}) };
  for (const key of INPUT_LAYOUT_KEYS) delete flattened[key as keyof typeof flattened];
  const currentRightPadding = typeof flattened.paddingRight === "number"
    ? flattened.paddingRight
    : typeof flattened.paddingHorizontal === "number"
      ? flattened.paddingHorizontal
      : typeof flattened.padding === "number" ? flattened.padding : 0;
  return [flattened, productFontStyle(style), voiceStyles.input, { paddingRight: Math.max(currentRightPadding, 44) }];
}

function assignForwardedRef(ref: ForwardedRef<NativeTextInput>, value: NativeTextInput | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref !== null) ref.current = value;
}

const voiceStyles = StyleSheet.create({
  input: { flex: 1, width: "100%", minWidth: 0, minHeight: 40 },
  button: {
    position: "absolute",
    right: 2,
    bottom: 2,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
  },
  buttonPressed: { backgroundColor: colors.surfaceContainerHighest },
  buttonDisabled: { opacity: 0.45 },
});
