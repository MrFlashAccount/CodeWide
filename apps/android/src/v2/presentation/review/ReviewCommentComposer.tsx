import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import type { ReviewAnchor } from "../../rendering/review/reviewModel";
import type { VoiceTextInputControl } from "../input/VoiceTextInputView";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ShimmerText } from "../text/ShimmerText";
import { PresentationTextInput, ProductText } from "../text/ProductText";

interface ReviewCommentComposerProps {
  anchor: ReviewAnchor;
  body: string;
  onCancel(): void;
  onBodyChange(body: string): void;
  onSave(anchor: ReviewAnchor, body: string): void;
  voice?: VoiceTextInputControl;
}

interface ReviewVoiceButtonProps {
  voice: VoiceTextInputControl;
}

export function ReviewCommentComposer(props: ReviewCommentComposerProps): React.JSX.Element {
  const { anchor, body, onBodyChange, onCancel, onSave, voice } = props;
  const insets = useSafeAreaInsets();
  const save = useEvent(() => {
    if (body.trim() !== "") onSave(anchor, body.trim());
  });
  return (
    <View pointerEvents="box-none" style={styles.layer}>
      <KeyboardStickyView offset={{ closed: 0, opened: 0 }} style={styles.sticky}>
        <View style={[styles.card, { paddingBottom: Math.max(spacing.sm, insets.bottom) }]}>
          <View style={styles.anchorRow}>
            <View style={styles.marker} />
            <ProductText numberOfLines={2} style={styles.anchor} tone="muted">
              {anchorLabel(anchor)}
            </ProductText>
            <Pressable
              accessibilityLabel="Cancel review comment"
              onPress={onCancel}
              style={styles.iconButton}
            >
              <Ionicons color={colors.textMuted} name="close" size={20} />
            </Pressable>
          </View>
          <View style={styles.composerRow}>
            <PresentationTextInput
              accessibilityLabel="Review comment"
              multiline
              onChangeText={onBodyChange}
              placeholder="What should change here?"
              placeholderTextColor={colors.textDim}
              style={styles.input}
              value={body}
            />
            {voice === undefined ? null : <ReviewVoiceButton voice={voice} />}
            <Pressable
              accessibilityLabel="Save review comment"
              accessibilityRole="button"
              disabled={body.trim() === ""}
              onPress={save}
              style={[styles.saveButton, body.trim() === "" && styles.disabled]}
            >
              <Ionicons color={colors.onPrimary} name="checkmark" size={21} />
            </Pressable>
          </View>
        </View>
      </KeyboardStickyView>
    </View>
  );
}

function ReviewVoiceButton(props: ReviewVoiceButtonProps): React.JSX.Element {
  const { voice } = props;
  const retry = voice.state === "retry";
  const active =
    voice.state === "starting" || voice.state === "recording" || voice.state === "finishing";
  const activate = useEvent(() => {
    voice.activate().catch(() => undefined);
  });
  return (
    <Pressable
      accessibilityLabel={
        retry
          ? "Retry review voice input"
          : active
            ? "Stop review voice input"
            : "Review voice input"
      }
      accessibilityRole="button"
      disabled={voice.disabled}
      onPress={activate}
      style={[styles.voiceButton, voice.disabled && styles.disabled]}
    >
      {voice.state === "starting" || voice.state === "finishing" ? (
        <ShimmerText style={styles.voiceProgress} text="•••" />
      ) : (
        <PresentationIcon
          color={voice.state === "recording" ? colors.red : colors.text}
          name={retry ? "refresh" : active ? "stop" : "mic"}
          size={20}
        />
      )}
    </Pressable>
  );
}

function anchorLabel(anchor: ReviewAnchor): string {
  if (anchor.kind === "line") return `${anchor.path}:${anchor.line} · ${anchor.context}`;
  if (anchor.kind === "text") return `“${anchor.quote.trim()}”`;
  if (anchor.kind === "diagram") return `Diagram point · ${anchor.diagramId}`;
  return "Entire agent response";
}

const styles = StyleSheet.create({
  anchor: { flex: 1, minWidth: 0, ...typeScale.label },
  anchorRow: { alignItems: "center", flexDirection: "row", gap: spacing.xs, minWidth: 0 },
  card: {
    alignSelf: "center",
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.accentMuted,
    borderTopWidth: 1,
    gap: spacing.sm,
    maxWidth: 760,
    padding: spacing.sm,
    width: "100%",
  },
  composerRow: { alignItems: "flex-end", flexDirection: "row", gap: spacing.xs },
  disabled: { opacity: 0.4 },
  iconButton: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  input: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.medium,
    color: colors.text,
    flex: 1,
    maxHeight: 160,
    minHeight: touchTarget,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    textAlignVertical: "top",
    ...typeScale.body,
  },
  layer: {
    bottom: 0,
    justifyContent: "flex-end",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 100,
  },
  marker: {
    alignSelf: "stretch",
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    width: 3,
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  sticky: { flexShrink: 0, width: "100%" },
  voiceButton: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  voiceProgress: { color: colors.textMuted, ...typeScale.label },
});
