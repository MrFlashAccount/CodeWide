import type { ComponentProps, ComponentType, ReactNode } from "react";
import {
  Pressable,
  type PressableStateCallbackType,
  StyleSheet,
  type TextInput as NativeTextInput,
  View,
} from "react-native";

import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { useEvent } from "../../../react/useEvent";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { PresentationIcon } from "../icons/PresentationIcon";
import { PresentationTextInput, ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import {
  ComposerPrimaryActionView,
  type ComposerPrimaryActionMode,
} from "./ComposerPrimaryActionView";
import { VoiceCaptureStatusView } from "./VoiceCaptureStatusView";

export interface ComposerTextInputProps extends ComponentProps<typeof NativeTextInput> {
  largePasteThreshold: number;
  onLargePaste(event: ComposerLargePasteEvent): void;
}

interface ComposerLargePasteEvent {
  end: number;
  start: number;
  text: string;
}

interface ComposerViewProps {
  attachmentTray?: ReactNode;
  disabled: boolean;
  deliveryActions?: readonly ActionMenuItem[];
  error?: string | null;
  hasAttachments?: boolean;
  InputComponent?: ComponentType<ComposerTextInputProps>;
  largePasteThreshold?: number;
  menuActions?: readonly ActionMenuItem[];
  onChangeText(text: string): void;
  onSelectDeliveryAction?(id: string): void;
  onLargePaste?(event: ComposerLargePasteEvent): void;
  onSelectMenu?(id: string): void;
  onSubmit(): void;
  onVoice?(): Promise<void>;
  onVoiceCancel?(): Promise<void>;
  pending: boolean;
  primaryAction?: ComposerPrimaryActionMode;
  retryBlocked: boolean;
  text: string;
  voiceDisabled?: boolean;
  voiceCancelDisabled?: boolean;
  voiceElapsedSeconds?: number;
  voiceLevel?: number;
  voiceMessage?: string | null;
  voiceState?: "idle" | "starting" | "recording" | "finishing" | "cancelling" | "retry" | "error";
}

export function ComposerView(props: ComposerViewProps): React.JSX.Element {
  const {
    disabled,
    deliveryActions,
    attachmentTray,
    error,
    hasAttachments = false,
    InputComponent,
    largePasteThreshold,
    menuActions,
    onChangeText,
    onLargePaste,
    onSelectMenu,
    onSelectDeliveryAction,
    onSubmit,
    onVoice,
    onVoiceCancel,
    pending,
    primaryAction = "send",
    retryBlocked,
    text,
    voiceDisabled = false,
    voiceCancelDisabled = false,
    voiceElapsedSeconds = 0,
    voiceLevel = 0,
    voiceMessage = null,
    voiceState = "idle",
  } = props;
  const voiceActive =
    voiceState === "starting" ||
    voiceState === "recording" ||
    voiceState === "finishing" ||
    voiceState === "cancelling" ||
    voiceState === "retry";
  const voiceRetryAvailable = voiceState === "retry";
  const voiceCanSubmit = voiceState === "starting" || voiceState === "recording";
  const voiceActionDisabled =
    voiceDisabled ||
    onVoice === undefined ||
    pending ||
    voiceState === "finishing" ||
    voiceState === "cancelling";
  const sendDisabled =
    disabled ||
    pending ||
    retryBlocked ||
    voiceState === "finishing" ||
    voiceState === "cancelling" ||
    voiceState === "retry" ||
    (primaryAction === "send" && !voiceCanSubmit && text.trim() === "" && !hasAttachments);
  const selectMenu = useEvent((id: string) => onSelectMenu?.(id));
  const selectDeliveryAction = useEvent((id: string) => onSelectDeliveryAction?.(id));
  const activateVoice = useEvent(() => {
    if (onVoice === undefined || voiceActionDisabled) return;
    void onVoice().catch(() => undefined);
  });
  const cancelVoice = useEvent(() => {
    if (onVoiceCancel === undefined || voiceCancelDisabled) return;
    void onVoiceCancel().catch(() => undefined);
  });
  const visibleError =
    error ?? (voiceState === "retry" || voiceState === "error" ? voiceMessage : null);
  return (
    <View style={styles.dock}>
      {attachmentTray}
      {visibleError === undefined || visibleError === null ? null : (
        <View style={styles.errorRow}>
          <ProductText accessibilityLiveRegion="polite" style={styles.error} tone="danger">
            {visibleError}
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
            <VoiceCaptureStatusView
              elapsedSeconds={voiceElapsedSeconds}
              level={voiceLevel}
              message={voiceMessage}
              state={voiceState}
            />
          ) : InputComponent !== undefined &&
            onLargePaste !== undefined &&
            largePasteThreshold !== undefined ? (
            <InputComponent
              accessibilityLabel="Message Codex"
              editable={!disabled && !pending}
              largePasteThreshold={largePasteThreshold}
              multiline
              onChangeText={onChangeText}
              onLargePaste={onLargePaste}
              placeholder="Message Codex…"
              placeholderTextColor={colors.textDim}
              style={styles.input}
              textAlignVertical="top"
              value={text}
            />
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
          {voiceActive ? (
            <Pressable
              accessibilityLabel="Cancel voice input"
              accessibilityRole="button"
              accessibilityState={{
                busy: voiceState === "cancelling",
                disabled: voiceCancelDisabled || onVoiceCancel === undefined,
              }}
              disabled={voiceCancelDisabled || onVoiceCancel === undefined}
              onPress={cancelVoice}
              style={[
                styles.inputAction,
                (voiceCancelDisabled || onVoiceCancel === undefined) && styles.disabled,
              ]}
            >
              {voiceState === "cancelling" ? (
                <ShimmerText style={styles.voiceProgress} text="•••" />
              ) : (
                <PresentationIcon color={colors.red} name="close" size={20} />
              )}
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel={
              voiceRetryAvailable
                ? "Retry voice transcription"
                : voiceActive
                  ? "Stop voice input and insert transcript"
                  : "Voice input"
            }
            accessibilityRole="button"
            accessibilityState={{
              busy: voiceState === "starting" || voiceState === "finishing",
              disabled: voiceActionDisabled,
            }}
            disabled={voiceActionDisabled}
            onPress={activateVoice}
            style={[styles.inputAction, voiceActionDisabled && styles.disabled]}
          >
            <PresentationIcon
              color={voiceRetryAvailable || !voiceActive ? colors.text : colors.red}
              name={voiceRetryAvailable ? "refresh" : voiceActive ? "stop" : "mic"}
              size={20}
            />
          </Pressable>
          {deliveryActions === undefined || onSelectDeliveryAction === undefined || voiceActive ? (
            <ComposerPrimaryActionView
              disabled={sendDisabled}
              mode={primaryAction}
              onPress={onSubmit}
              pending={pending}
              voiceActive={voiceActive}
              voiceFinishing={voiceState === "finishing"}
              voiceStarting={voiceState === "starting"}
            />
          ) : (
            <ActionMenu
              accessibilityLabel="Delivery mode"
              actions={deliveryActions}
              onSelect={selectDeliveryAction}
              placement="top"
              style={styles.primaryActionMenu}
              trigger="long-press"
            >
              <ComposerPrimaryActionView
                disabled={sendDisabled}
                mode={primaryAction}
                onPress={onSubmit}
                pending={pending}
                voiceActive={false}
                voiceFinishing={false}
                voiceStarting={false}
              />
            </ActionMenu>
          )}
        </View>
      </View>
    </View>
  );
}

function disabledMenuStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.menu, styles.disabled, pressed && styles.pressed];
}

function enabledMenuStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.menu, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.45 },
  dock: { backgroundColor: colors.surface, flexShrink: 0 },
  error: { flex: 1, ...typeScale.label },
  errorRow: {
    alignItems: "center",
    backgroundColor: colors.surface,
    flexDirection: "row",
    minHeight: 34,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  input: {
    alignSelf: "stretch",
    color: colors.text,
    flex: 1,
    flexBasis: 0,
    flexShrink: 1,
    ...typeScale.composerInput,
    maxHeight: 132,
    minHeight: touchTarget,
    minWidth: 0,
    paddingBottom: spacing.composerInputBottom,
    paddingLeft: spacing.sm,
    paddingRight: spacing.xxs,
    paddingTop: spacing.sm,
    width: 0,
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
    flexBasis: 0,
    flexShrink: 1,
    flexDirection: "row",
    maxHeight: 132,
    minHeight: touchTarget,
    minWidth: 0,
    overflow: "hidden",
    width: 0,
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
  primaryActionMenu: { flexShrink: 0, height: touchTarget, width: touchTarget },
  row: {
    alignItems: "flex-end",
    alignSelf: "stretch",
    backgroundColor: colors.surface,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: touchTarget + 12,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.composerRow,
  },
  voiceProgress: { color: colors.accent, ...typeScale.label },
});
