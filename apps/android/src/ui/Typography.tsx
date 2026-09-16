import { Ionicons } from "@expo/vector-icons";
import {
  forwardRef,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ForwardedRef,
} from "react";
import {
  ActivityIndicator,
  findNodeHandle,
  Pressable,
  StyleSheet,
  TextInput as NativeTextInput,
  type StyleProp,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";

import { installLargePasteInterceptor, type LargePasteEvent } from "../native/large-paste";
import { setNativeVoiceAuraOrigin } from "../native/native-transport";
import { colors, iconSize, radii, controlSize, controlHitSlop, spacing } from "../theme";
import { productFontStyle } from "./AppText";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "./typography-policy";
import { useAppVoiceInputRuntime, useVoiceInputResource } from "./VoiceInputRuntime";
import { shouldEnableVoiceInput } from "./voice-input-policy";
import { useMicrophoneAccess } from "./use-microphone-access";

export { AppText, productFontStyle } from "./AppText";

export type AppTextInputProps = ComponentProps<typeof NativeTextInput> & {
  /** Fit voice controls into a 40dp single-line field without changing ordinary inputs. */
  compact?: boolean;
  /** Consume clipboard text above this limit before Android chunks the paste. */
  largePasteThreshold?: number;
  onLargePaste?: (event: LargePasteEvent) => void;
  /** Natural-language fields enable voice input by default. */
  voiceInput?: boolean;
  /** Stable semantic scope for composite inputs that render voice state elsewhere. */
  voiceScope?: string;
};

export const AppTextInput = forwardRef<NativeTextInput, AppTextInputProps>(function AppTextInput(
  {
    allowFontScaling = true,
    compact = false,
    defaultValue,
    editable,
    inputMode,
    keyboardType,
    largePasteThreshold,
    maxFontSizeMultiplier = APP_MAX_FONT_SIZE_MULTIPLIER,
    onChangeText,
    onLargePaste,
    onSelectionChange,
    secureTextEntry,
    selection,
    style,
    value,
    voiceInput,
    voiceScope,
    ...props
  },
  forwardedRef,
) {
  const runtime = useAppVoiceInputRuntime();
  const generatedId = useId();
  const inputRef = useRef<NativeTextInput | null>(null);
  const uncontrolledValueRef = useRef(defaultValue ?? "");
  const selectionRef = useRef<{ end: number; start: number } | null>(
    selection === undefined
      ? null
      : { end: selection.end ?? selection.start, start: selection.start },
  );
  const enabled =
    runtime?.controller !== null &&
    runtime?.controller !== undefined &&
    shouldEnableVoiceInput({
      ...(voiceInput === undefined ? {} : { voiceInput }),
      ...(editable === undefined ? {} : { editable }),
      ...(secureTextEntry === undefined ? {} : { secureTextEntry }),
      ...(keyboardType === undefined ? {} : { keyboardType }),
      ...(inputMode === undefined ? {} : { inputMode }),
    });
  const scope = enabled
    ? (voiceScope ?? `${runtime.scopePrefix}\u0000input\u0000${generatedId}`)
    : null;
  const mountedScopeRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    mountedScopeRef.current = scope;
    return () => {
      mountedScopeRef.current = null;
    };
  }, [scope]);
  const voice = useVoiceInputResource(runtime, scope);
  const voicePhase = voice?.phase ?? "idle";
  const retryAvailable = voice?.retryAvailable ?? false;
  const pendingSelection = voice?.pendingSelection ?? null;
  const currentValue = () => (typeof value === "string" ? value : uncontrolledValueRef.current);
  const updateValue = (next: string) => {
    uncontrolledValueRef.current = next;
    if (typeof value !== "string") {
      inputRef.current?.setNativeProps({ text: next });
    }
    onChangeText?.(next);
  };
  const currentSelection = () =>
    selectionRef.current ?? { end: currentValue().length, start: currentValue().length };
  const bindVoice = () => {
    if (runtime?.controller === null || runtime?.controller === undefined || scope === null) {
      return;
    }
    runtime.controller.bind({
      scope,
      selection: currentSelection,
      source: currentValue,
      thread: runtime.thread,
      // Keep the starting field's callback, not a useEvent callback that can
      // retarget a pending transcript to a replacement input after navigation.
      send: (next) => {
        if (mountedScopeRef.current === scope) {
          updateValue(next);
        }
      },
      updateDraft: (next) => {
        if (mountedScopeRef.current === scope) {
          updateValue(next);
        }
      },
      ...(runtime.startRemote === undefined ? {} : { startRemote: runtime.startRemote }),
    });
  };
  const pressVoice = async () => {
    if (runtime?.controller === null || runtime?.controller === undefined || scope === null) {
      return;
    }
    inputRef.current?.focus();
    bindVoice();
    if (retryAvailable) {
      await runtime.controller.retry(scope);
    } else if (voicePhase === "idle") {
      await runtime.controller.toggle(scope);
    } else if (voicePhase !== "finishing") {
      await runtime.controller.finish(scope, false);
    }
  };
  const setInputRef = (node: NativeTextInput | null) => {
    inputRef.current = node;
    assignForwardedRef(forwardedRef, node);
  };
  const handleLargePaste = useEffectEvent((event: LargePasteEvent) => onLargePaste?.(event));
  const largePasteToken = `large-paste-${generatedId}`;
  const largePasteEnabled = onLargePaste !== undefined && largePasteThreshold !== undefined;
  useLayoutEffect(() => {
    if (!largePasteEnabled) {
      return undefined;
    }
    const reactTag = findNodeHandle(inputRef.current);
    if (reactTag === null) {
      return undefined;
    }
    return (
      installLargePasteInterceptor(
        reactTag,
        largePasteToken,
        largePasteThreshold,
        handleLargePaste,
      ) ?? undefined
    );
  }, [largePasteEnabled, largePasteThreshold, largePasteToken]);
  const handleChangeText = (next: string) => {
    uncontrolledValueRef.current = next;
    onChangeText?.(next);
  };
  const handleSelectionChange: NonNullable<
    ComponentProps<typeof NativeTextInput>["onSelectionChange"]
  > = (event) => {
    selectionRef.current = event.nativeEvent.selection;
    onSelectionChange?.(event);
    if (
      scope !== null &&
      pendingSelection !== null &&
      pendingSelection.start === event.nativeEvent.selection.start &&
      pendingSelection.end === event.nativeEvent.selection.end
    ) {
      runtime?.controller?.clearPendingSelection(scope);
    }
  };
  const input = (
    <NativeTextInput
      ref={setInputRef}
      {...props}
      allowFontScaling={allowFontScaling}
      defaultValue={defaultValue}
      editable={editable}
      inputMode={inputMode}
      keyboardType={keyboardType}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      onChangeText={handleChangeText}
      onSelectionChange={handleSelectionChange}
      secureTextEntry={secureTextEntry}
      selection={pendingSelection ?? selection}
      style={
        enabled
          ? [voiceInputTextStyle(style), compact && voiceStyles.compactInput]
          : [style, productFontStyle(style)]
      }
      value={value}
    />
  );
  if (!enabled) {
    return input;
  }
  return (
    <View style={voiceInputContainerStyle(style)}>
      {input}
      <InputVoiceButton
        compact={compact}
        error={voice?.error ?? null}
        onPress={pressVoice}
        phase={voicePhase}
        retryAvailable={retryAvailable}
      />
    </View>
  );
});

type InputVoiceButtonProps = {
  compact: boolean;
  error: string | null;
  onPress: () => Promise<void>;
  phase: "idle" | "starting" | "recording" | "finishing";
  retryAvailable: boolean;
};

function InputVoiceButton(props: InputVoiceButtonProps) {
  const microphoneButtonRef = useRef<View | null>(null);
  const access = useMicrophoneAccess();
  const finishing = props.phase === "finishing" && !props.retryAvailable;
  const needsPermission = props.phase === "idle" && !props.retryAvailable && !access.granted;
  return (
    <Pressable
      accessibilityLabel={
        props.retryAvailable
          ? "Retry voice input"
          : props.phase === "idle"
            ? access.granted
              ? "Voice input"
              : "Allow microphone access"
            : "Stop voice input"
      }
      accessibilityRole="button"
      disabled={finishing}
      hitSlop={props.compact ? controlHitSlop.compact : controlHitSlop.regular}
      onPress={() => {
        if (props.phase === "idle" && !props.retryAvailable && !access.allowCapture()) {
          return;
        }
        access.run(async () => {
          await props.onPress();
        });
      }}
      onPressIn={() => {
        if (props.phase === "idle" && access.granted) {
          setNativeVoiceAuraOrigin(findNodeHandle(microphoneButtonRef.current));
        }
      }}
      ref={microphoneButtonRef}
      style={({ pressed }) => [
        voiceStyles.button,
        props.compact && voiceStyles.compactButton,
        pressed && voiceStyles.buttonPressed,
        (needsPermission || finishing) && voiceStyles.buttonDisabled,
      ]}
    >
      {props.phase === "starting" || finishing ? (
        <ActivityIndicator color={colors.accent} size="small" />
      ) : (
        <Ionicons
          color={
            props.phase === "recording" || props.error !== null ? colors.red : colors.textMuted
          }
          name={props.retryAvailable ? "refresh" : props.phase === "idle" ? "mic-outline" : "stop"}
          size={iconSize.action}
        />
      )}
    </Pressable>
  );
}

const INPUT_LAYOUT_KEYS: ReadonlyArray<keyof TextStyle & keyof ViewStyle> = [
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

function voiceInputContainerStyle(style: StyleProp<TextStyle>): StyleProp<ViewStyle> {
  const flattened = StyleSheet.flatten(style);
  const layout: ViewStyle = { minHeight: 40 };
  for (const key of INPUT_LAYOUT_KEYS) {
    const value = flattened[key];
    if (value !== undefined) {
      Object.assign(layout, { [key]: value });
    }
  }
  return layout;
}

function voiceInputTextStyle(style: StyleProp<TextStyle>): StyleProp<TextStyle> {
  const flattened = { ...StyleSheet.flatten(style) };
  for (const key of INPUT_LAYOUT_KEYS) {
    delete flattened[key];
  }
  const currentRightPadding =
    typeof flattened.paddingRight === "number"
      ? flattened.paddingRight
      : typeof flattened.paddingHorizontal === "number"
        ? flattened.paddingHorizontal
        : typeof flattened.padding === "number"
          ? flattened.padding
          : 0;
  return [
    flattened,
    productFontStyle(style),
    voiceStyles.input,
    { paddingRight: Math.max(currentRightPadding, controlSize.regular + spacing.xxs) },
  ];
}

function assignForwardedRef(
  ref: ForwardedRef<NativeTextInput>,
  value: NativeTextInput | null,
): void {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref !== null) {
    ref.current = value;
  }
}

const voiceStyles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: radii.pill,
    bottom: (controlSize.touch - controlSize.regular) / 2,
    height: controlSize.regular,
    justifyContent: "center",
    position: "absolute",
    right: spacing.optical,
    width: controlSize.regular,
  },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { backgroundColor: colors.surfaceContainerHighest },
  compactButton: {
    height: controlSize.compact,
    width: controlSize.compact,
  },
  compactInput: {
    minHeight: controlSize.regular,
    paddingRight: controlSize.compact + spacing.xxs,
  },
  input: {
    flex: 1,
    minHeight: controlSize.touch,
    minWidth: 0,
    width: "100%",
  },
});
