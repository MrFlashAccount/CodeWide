import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableStateCallbackType,
  StyleSheet,
  View,
} from "react-native";

import { colors, radii, spacing, touchTarget } from "../../theme";
import { useEvent } from "../../react/useEvent";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { PresentationIcon } from "../icons/PresentationIcon";
import { PresentationTextInput, ProductText } from "../text/ProductText";

interface ComposerViewProps {
  disabled: boolean;
  error?: string | null;
  menuActions?: readonly ActionMenuItem[];
  onChangeText(text: string): void;
  onSelectMenu?(id: string): void;
  onSubmit(): void;
  onVoice?(): Promise<void>;
  pending: boolean;
  retryBlocked: boolean;
  text: string;
  voiceDisabled?: boolean;
  voiceMessage?: string | null;
  voiceState?: "idle" | "starting" | "recording" | "finishing" | "retry" | "error";
}

export function ComposerView(props: ComposerViewProps): React.JSX.Element {
  const {
    disabled,
    error,
    menuActions,
    onChangeText,
    onSelectMenu,
    onSubmit,
    onVoice,
    pending,
    retryBlocked,
    text,
    voiceDisabled = false,
    voiceMessage = null,
    voiceState = "idle",
  } = props;
  const sendDisabled = disabled || pending || retryBlocked || text.trim() === "";
  const [voicePending, setVoicePending] = useState(false);
  const voiceActive =
    voiceState === "starting" || voiceState === "recording" || voiceState === "finishing";
  const selectMenu = useEvent((id: string) => onSelectMenu?.(id));
  const activateVoice = useEvent(() => {
    if (onVoice === undefined || voiceDisabled || voicePending) return;
    setVoicePending(true);
    onVoice()
      .finally(() => setVoicePending(false))
      .catch(() => undefined);
  });
  return (
    <View style={styles.dock}>
      {error === undefined || error === null ? null : (
        <View style={styles.errorRow}>
          <ProductText accessibilityLiveRegion="polite" style={styles.error} tone="danger">
            {error}
          </ProductText>
        </View>
      )}
      <View style={styles.row}>
        {menuActions === undefined || onSelectMenu === undefined ? (
          <Pressable
            accessibilityLabel="Composer menu"
            accessibilityRole="button"
            disabled
            style={disabledMenuStyle}
          >
            <PresentationIcon color={colors.text} name="add" size={22} />
          </Pressable>
        ) : (
          <ActionMenu
            accessibilityLabel="Composer menu"
            actions={menuActions}
            align="start"
            onSelect={selectMenu}
            placement="top"
            style={styles.menuAnchor}
          >
            <Pressable
              accessibilityLabel="Composer menu"
              accessibilityRole="button"
              style={enabledMenuStyle}
            >
              <PresentationIcon color={colors.text} name="add" size={22} />
            </Pressable>
          </ActionMenu>
        )}
        <View style={styles.inputShell}>
          {voiceActive ? (
            <View accessibilityLabel="Voice recording" style={styles.voiceStatus}>
              <ActivityIndicator color={colors.primary} size="small" />
              <ProductText numberOfLines={1} style={styles.voiceLabel} tone="muted">
                {voiceStatusLabel(voiceState, voiceMessage)}
              </ProductText>
            </View>
          ) : (
            <PresentationTextInput
              accessibilityLabel="Message Codex"
              editable={!disabled && !pending}
              multiline
              onChangeText={onChangeText}
              placeholder="Message Codex…"
              placeholderTextColor={colors.textDim}
              style={styles.input}
              textAlignVertical="top"
              value={text}
            />
          )}
          <Pressable
            accessibilityLabel={
              voiceActive ? "Stop voice input and insert transcript" : "Voice input"
            }
            accessibilityRole="button"
            accessibilityState={{
              busy: voicePending,
              disabled: voiceDisabled || onVoice === undefined,
            }}
            disabled={voiceDisabled || onVoice === undefined}
            onPress={activateVoice}
            style={[
              styles.inputAction,
              (voiceDisabled || onVoice === undefined) && styles.disabled,
            ]}
          >
            <PresentationIcon
              color={voiceActive ? colors.red : colors.text}
              name={voiceActive ? "stop" : voiceState === "error" ? "refresh" : "mic"}
              size={20}
            />
          </Pressable>
          <Pressable
            accessibilityLabel="Send message"
            accessibilityRole="button"
            accessibilityState={{ busy: pending, disabled: sendDisabled }}
            disabled={sendDisabled}
            onPress={onSubmit}
            style={sendDisabled ? disabledSendStyle : enabledSendStyle}
          >
            {pending ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <PresentationIcon color={colors.onPrimary} name="send" size={21} />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function voiceStatusLabel(
  state: NonNullable<ComposerViewProps["voiceState"]>,
  message: string | null,
): string {
  if (message !== null) return message;
  if (state === "starting") return "Starting voice…";
  if (state === "finishing") return "Finishing voice…";
  return "Listening…";
}

function disabledMenuStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.menu, styles.disabled, pressed && styles.pressed];
}

function disabledSendStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.send, styles.disabled, pressed && styles.sendPressed];
}

function enabledMenuStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.menu, pressed && styles.pressed];
}

function enabledSendStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.send, pressed && styles.sendPressed];
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.45 },
  dock: { backgroundColor: colors.surface, flexShrink: 0 },
  error: { flex: 1, fontSize: 12, lineHeight: 17 },
  errorRow: {
    alignItems: "center",
    backgroundColor: colors.surface,
    flexDirection: "row",
    minHeight: 34,
    paddingHorizontal: 14,
    paddingTop: 5,
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    maxHeight: 132,
    minHeight: touchTarget,
    minWidth: 0,
    paddingBottom: 10,
    paddingLeft: spacing.sm,
    paddingRight: spacing.xxs,
    paddingTop: 12,
  },
  inputAction: {
    alignItems: "center",
    flexShrink: 0,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  inputShell: {
    alignItems: "flex-end",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.composer,
    flex: 1,
    flexDirection: "row",
    minHeight: touchTarget,
    minWidth: 0,
  },
  menu: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.composer,
    flexShrink: 0,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  menuAnchor: { flexShrink: 0, height: touchTarget, width: touchTarget },
  pressed: { opacity: 0.68 },
  row: {
    alignItems: "flex-end",
    alignSelf: "stretch",
    backgroundColor: colors.surface,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: touchTarget + 12,
    paddingHorizontal: spacing.xs,
    paddingVertical: 6,
  },
  send: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.composer,
    flexShrink: 0,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  sendPressed: { backgroundColor: colors.primaryPressed },
  voiceLabel: { flex: 1, fontSize: 13, lineHeight: 18 },
  voiceStatus: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: touchTarget,
    minWidth: 0,
    paddingLeft: spacing.sm,
  },
});
