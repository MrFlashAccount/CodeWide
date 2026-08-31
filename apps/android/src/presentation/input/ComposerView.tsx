import {
  ActivityIndicator,
  Pressable,
  type PressableStateCallbackType,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { colors, radii, spacing, touchTarget } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";

interface ComposerViewProps {
  disabled: boolean;
  error?: string | null;
  onChangeText(text: string): void;
  onOpenMenu?(): void;
  onSubmit(): void;
  pending: boolean;
  retryBlocked: boolean;
  text: string;
}

export function ComposerView({
  disabled,
  error,
  onChangeText,
  onOpenMenu,
  onSubmit,
  pending,
  retryBlocked,
  text,
}: ComposerViewProps): React.JSX.Element {
  const sendDisabled = disabled || pending || retryBlocked;
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
        <Pressable
          accessibilityLabel="Composer menu"
          accessibilityRole="button"
          disabled={onOpenMenu === undefined}
          onPress={onOpenMenu}
          style={onOpenMenu === undefined ? disabledMenuStyle : enabledMenuStyle}
        >
          <PresentationIcon color={colors.text} name="add" size={22} />
        </Pressable>
        <View style={styles.inputShell}>
          <TextInput
            accessibilityLabel="V2 message composer"
            editable={!disabled && !pending}
            multiline
            onChangeText={onChangeText}
            placeholder="Message Codex…"
            placeholderTextColor={colors.textDim}
            style={styles.input}
            textAlignVertical="top"
            value={text}
          />
          <Pressable
            accessibilityLabel="Voice input"
            accessibilityRole="button"
            disabled
            style={styles.inputAction}
          >
            <PresentationIcon color={colors.textMuted} name="mic" size={20} />
          </Pressable>
          <Pressable
            accessibilityLabel="Send V2 message"
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

function disabledMenuStyle({ pressed }: PressableStateCallbackType) {
  return [styles.menu, styles.disabled, pressed && styles.pressed];
}

function disabledSendStyle({ pressed }: PressableStateCallbackType) {
  return [styles.send, styles.disabled, pressed && styles.sendPressed];
}

function enabledMenuStyle({ pressed }: PressableStateCallbackType) {
  return [styles.menu, pressed && styles.pressed];
}

function enabledSendStyle({ pressed }: PressableStateCallbackType) {
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
    fontFamily: "RobotoFlex-Regular",
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
    width: 40,
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
});
