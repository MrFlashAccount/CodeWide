import { useState, useTransition, type ComponentProps, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { PresentationTextInput, ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import { PresentationIcon } from "../icons/PresentationIcon";
import type { QueueEditorAttachmentModel, QueueEditorSubmission } from "./queueTypes";

export interface QueueEditorViewProps {
  attachments: readonly QueueEditorAttachmentModel[];
  disabled?: boolean;
  initialText: string;
  onAddFile(): Promise<void>;
  onAddImage(): Promise<void>;
  onCancel(): Promise<void> | void;
  onRemoveAttachment(attachment: QueueEditorAttachmentModel): Promise<void> | void;
  onRetryAttachment(attachment: QueueEditorAttachmentModel): Promise<void>;
  onSave(input: QueueEditorSubmission): Promise<void>;
  onTextChange?(text: string): void;
  renderTextInput?(props: ComponentProps<typeof PresentationTextInput>): ReactNode;
  text?: string;
}

export function QueueEditorView(props: QueueEditorViewProps): React.JSX.Element {
  const {
    attachments,
    disabled = false,
    initialText,
    onAddFile,
    onAddImage,
    onCancel,
    onRemoveAttachment,
    onRetryAttachment,
    onSave,
    onTextChange,
    renderTextInput,
    text: controlledText,
  } = props;
  const [uncontrolledText, setUncontrolledText] = useState(initialText);
  const text = controlledText ?? uncontrolledText;
  const [error, setError] = useState<string | null>(null);
  const [pending, startSave] = useTransition();
  const updateText = useEvent((value: string) => {
    if (onTextChange === undefined) setUncontrolledText(value);
    else onTextChange(value);
  });
  const save = useEvent(() => {
    const normalized = text.trim();
    if ((attachments.length === 0 && normalized === "") || pending) return;
    setError(null);
    startSave(async () => {
      try {
        await onSave({
          retainedAttachmentIds: attachments.flatMap((attachment) =>
            attachment.source === "retained" ? [attachment.id] : [],
          ),
          text: normalized,
        });
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : "Could not edit queued prompt");
      }
    });
  });
  const runAttachmentAction = useEvent((action: () => Promise<void> | void) => {
    if (pending) return;
    setError(null);
    startSave(async () => {
      try {
        await action();
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : "Attachment action failed");
      }
    });
  });
  const addFile = useEvent(() => runAttachmentAction(onAddFile));
  const addImage = useEvent(() => runAttachmentAction(onAddImage));
  const cancel = useEvent(() => runAttachmentAction(onCancel));
  return (
    <View style={styles.root}>
      {renderTextInput?.({
        accessibilityLabel: "Queued prompt text",
        editable: !disabled && !pending,
        multiline: true,
        onChangeText: updateText,
        placeholder: "Message Codex…",
        placeholderTextColor: colors.textDim,
        style: styles.input,
        textAlignVertical: "top",
        value: text,
      }) ?? (
        <PresentationTextInput
          accessibilityLabel="Queued prompt text"
          editable={!disabled && !pending}
          multiline
          onChangeText={updateText}
          placeholder="Message Codex…"
          placeholderTextColor={colors.textDim}
          style={styles.input}
          textAlignVertical="top"
          value={text}
        />
      )}
      {attachments.map((attachment) => (
        <QueueEditorAttachmentRow
          attachment={attachment}
          key={`${attachment.source}:${attachment.id}`}
          onRemove={onRemoveAttachment}
          onRetry={onRetryAttachment}
          pending={pending}
          run={runAttachmentAction}
        />
      ))}
      <View style={styles.attachmentActions}>
        <QueueEditorAttachmentAction
          icon="attach"
          label="Attach file"
          onPress={addFile}
          pending={disabled || pending}
        />
        <QueueEditorAttachmentAction
          icon="layers"
          label="Attach image"
          onPress={addImage}
          pending={disabled || pending}
        />
      </View>
      {error === null ? null : (
        <ProductText accessibilityLiveRegion="polite" style={styles.error} tone="danger">
          {error}
        </ProductText>
      )}
      <View style={styles.actions}>
        <Pressable
          accessibilityLabel="Cancel queued prompt edit"
          accessibilityRole="button"
          accessibilityState={{ disabled: disabled || pending }}
          disabled={disabled || pending}
          onPress={cancel}
        >
          <ProductText style={styles.actionLabel}>Cancel</ProductText>
        </Pressable>
        <Pressable
          accessibilityLabel="Save queued prompt"
          accessibilityRole="button"
          accessibilityState={{
            busy: pending,
            disabled: disabled || pending || (attachments.length === 0 && text.trim() === ""),
          }}
          disabled={disabled || pending || (attachments.length === 0 && text.trim() === "")}
          onPress={save}
          style={styles.save}
        >
          {pending ? (
            <ShimmerText style={styles.saveLabel} text="Saving" />
          ) : (
            <ProductText style={styles.saveLabel} weight="semibold">
              Save
            </ProductText>
          )}
        </Pressable>
      </View>
    </View>
  );
}

interface QueueEditorAttachmentRowProps {
  attachment: QueueEditorAttachmentModel;
  onRemove(attachment: QueueEditorAttachmentModel): Promise<void> | void;
  onRetry(attachment: QueueEditorAttachmentModel): Promise<void>;
  pending: boolean;
  run(action: () => Promise<void> | void): void;
}

function QueueEditorAttachmentRow(props: QueueEditorAttachmentRowProps): React.JSX.Element {
  const { attachment, onRemove, onRetry, pending, run } = props;
  const remove = useEvent(() => run(() => onRemove(attachment)));
  const retry = useEvent(() => run(() => onRetry(attachment)));
  return (
    <View style={styles.attachmentRow}>
      <PresentationIcon color={colors.textMuted} name="attach" size={17} />
      <View style={styles.attachmentCopy}>
        <ProductText numberOfLines={1}>{attachment.label}</ProductText>
        {attachment.error === null ? null : (
          <ProductText numberOfLines={1} tone="danger">
            {attachment.error}
          </ProductText>
        )}
      </View>
      {attachment.state === "error" ? (
        <QueueEditorAttachmentAction
          icon="refresh"
          label="Retry attachment"
          onPress={retry}
          pending={pending}
        />
      ) : null}
      <QueueEditorAttachmentAction
        icon="close"
        label="Remove attachment"
        onPress={remove}
        pending={pending}
      />
    </View>
  );
}

interface QueueEditorAttachmentActionProps {
  icon: "attach" | "close" | "layers" | "refresh";
  label: string;
  onPress(): void;
  pending: boolean;
}

function QueueEditorAttachmentAction(props: QueueEditorAttachmentActionProps): React.JSX.Element {
  const { icon, label, onPress, pending } = props;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: pending, disabled: pending }}
      disabled={pending}
      onPress={onPress}
      style={styles.attachmentAction}
    >
      <PresentationIcon color={colors.textMuted} name={icon} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actionLabel: { color: colors.textMuted, ...typeScale.label },
  attachmentAction: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  attachmentActions: { alignItems: "center", flexDirection: "row" },
  attachmentCopy: { flex: 1, minWidth: 0 },
  attachmentRow: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.small,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: touchTarget,
    paddingLeft: spacing.sm,
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "flex-end",
  },
  error: { ...typeScale.label },
  input: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.small,
    color: colors.text,
    maxHeight: 160,
    minHeight: 92,
    padding: spacing.sm,
    ...typeScale.body,
  },
  root: { gap: spacing.sm },
  save: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    justifyContent: "center",
    minHeight: touchTarget,
    minWidth: 88,
    paddingHorizontal: spacing.md,
  },
  saveLabel: { color: colors.onPrimary, ...typeScale.label },
});
