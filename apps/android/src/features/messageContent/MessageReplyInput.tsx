import { useSelector } from "@legendapp/state/react";
import { useRef } from "react";
import { Pressable, StyleSheet, View, type Text as NativeText } from "react-native";

import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import {
  colors,
  controlHitSlop,
  controlSize,
  disabledOpacity,
  radii,
  spacing,
  typeScale,
  typeWeight,
} from "../../theme";
import { TextShimmer } from "../../ui/TextShimmer";
import { AppText as Text } from "../../ui/Typography";
import { ComposerMarkdownInput } from "../composer/input/ComposerMarkdownInput";
import type { MessageSendResult } from "./messageContent";
import { createMessageReplyModel } from "./messageReplyModel";

/** Props of one reply input; `onSend` resolves with how the write ended and never rejects. */
export type MessageReplyInputProps = {
  readonly accessibilityLabel: string;
  readonly onSend: (markdown: string) => Promise<MessageSendResult>;
  readonly placeholder: string;
  readonly testID: string;
};

const PRESSED_OPACITY = 0.72;
const INPUT_MAX_HEIGHT = 160;

/** Message inputs offer no `/` or `@` suggestions. */
const NO_MENTIONS: Promise<readonly never[]> = Promise.resolve([]);
async function noMentions(): Promise<readonly never[]> {
  return NO_MENTIONS;
}

/**
 * Markdown input with Send. While a write is pending the typed text stays in
 * place and shimmers over the hidden editor, so the geometry does not move; an
 * acknowledged send clears it; a failure stops the shimmer, restores the
 * editor with the same text and shows the real error below it.
 */
export function MessageReplyInput(props: MessageReplyInputProps): React.JSX.Element {
  const model = useConstant(createMessageReplyModel);
  const pendingText = useSelector(() =>
    model.submission.status.get() === "pending" ? model.draft.plainText.get() : null,
  );
  const canSend = useSelector(
    () =>
      model.submission.status.get() !== "pending" && model.draft.plainText.get().trim().length > 0,
  );
  const failure = useSelector(() => {
    const submission = model.submission.get();
    return submission.status === "failed" ? submission.message : null;
  });
  const generation = useSelector(() => model.editorGeneration.get());
  const change = useEvent((value: { readonly markdown: string; readonly plainText: string }) => {
    model.draft.set({ markdown: value.markdown, plainText: value.plainText });
    if (model.submission.status.peek() === "failed") {
      model.submission.set({ status: "editing" });
    }
  });
  const settle = (result: MessageSendResult): void => {
    if (result.status === "sent") {
      model.set({
        draft: { markdown: "", plainText: "" },
        editorGeneration: model.editorGeneration.peek() + 1,
        submission: { status: "editing" },
      });
    } else if (result.status === "refused") {
      model.submission.set({ status: "editing" });
    } else {
      model.submission.set({ message: result.message, status: "failed" });
    }
  };
  const send = useEvent((): void => {
    const draft = model.draft.peek();
    if (model.submission.status.peek() === "pending" || draft.plainText.trim().length === 0) {
      return;
    }
    model.submission.set({ status: "pending" });
    props
      .onSend(draft.markdown.trim().length > 0 ? draft.markdown : draft.plainText)
      .then(settle, (error: unknown) => {
        settle({
          message: error instanceof Error ? error.message : "The message was not sent",
          status: "failed",
        });
      });
  });
  return (
    <View style={styles.frame} testID={props.testID}>
      <View style={styles.row}>
        <ReplyEditor
          accessibilityLabel={props.accessibilityLabel}
          generation={generation}
          onChange={change}
          pendingText={pendingText}
          placeholder={props.placeholder}
          testID={props.testID}
        />
        <SendButton
          disabled={!canSend}
          onPress={send}
          pending={pendingText !== null}
          testID={`${props.testID}-send`}
        />
      </View>
      {failure === null ? null : (
        <Text
          accessibilityLiveRegion="polite"
          style={styles.error}
          testID={`${props.testID}-error`}
        >
          {failure}
        </Text>
      )}
    </View>
  );
}

/**
 * The editor stays mounted while a write is pending, hidden under the same
 * text shimmering in place; a new generation remounts it empty after a send.
 */
function ReplyEditor({
  accessibilityLabel,
  generation,
  onChange,
  pendingText,
  placeholder,
  testID,
}: {
  readonly accessibilityLabel: string;
  readonly generation: number;
  readonly onChange: (value: { readonly markdown: string; readonly plainText: string }) => void;
  readonly pendingText: string | null;
  readonly placeholder: string;
  readonly testID: string;
}): React.JSX.Element {
  const pendingLabel = useRef<NativeText>(null);
  const pending = pendingText !== null;
  return (
    <View style={styles.editor}>
      <View
        importantForAccessibility={pending ? "no-hide-descendants" : "auto"}
        pointerEvents={pending ? "none" : "auto"}
        style={[styles.editorLayer, pending && styles.hidden]}
      >
        <ComposerMarkdownInput
          accessibilityLabel={accessibilityLabel}
          key={generation}
          mentionIndicators={[]}
          onChangeValue={onChange}
          placeholder={placeholder}
          search={noMentions}
          style={styles.input}
          value=""
        />
      </View>
      {pendingText === null ? null : (
        <Text
          accessibilityState={{ busy: true }}
          ref={pendingLabel}
          style={[styles.input, styles.pendingText]}
          testID={`${testID}-pending`}
        >
          {pendingText}
        </Text>
      )}
      <TextShimmer shimmering={pending} target={pendingLabel} />
    </View>
  );
}

function SendButton({
  disabled,
  onPress,
  pending,
  testID,
}: {
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly pending: boolean;
  readonly testID: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel="Send"
      accessibilityRole="button"
      accessibilityState={{ busy: pending, disabled }}
      disabled={disabled}
      hitSlop={controlHitSlop.compact}
      onPress={onPress}
      style={({ pressed }) => [
        styles.send,
        disabled ? styles.sendDisabled : styles.sendEnabled,
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      <Text style={[styles.sendLabel, !disabled && styles.sendLabelEnabled]}>Send</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  editor: {
    flex: 1,
    flexDirection: "row",
    minWidth: 0,
  },
  editorLayer: {
    flex: 1,
    flexDirection: "row",
    minWidth: 0,
  },
  error: {
    ...typeScale.label,
    color: colors.error,
  },
  frame: {
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: 1,
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  hidden: {
    opacity: 0,
  },
  input: {
    ...typeScale.body,
    color: colors.text,
    maxHeight: INPUT_MAX_HEIGHT,
  },
  // Sits exactly over the hidden editor so the pending text keeps its place.
  pendingText: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    textAlignVertical: "center",
    top: 0,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  row: {
    alignItems: "flex-end",
    columnGap: spacing.xs,
    flexDirection: "row",
  },
  send: {
    alignItems: "center",
    borderRadius: radii.medium,
    justifyContent: "center",
    marginBottom: spacing.xxs,
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.sm,
  },
  sendDisabled: {
    backgroundColor: colors.surfaceContainerHigh,
    opacity: disabledOpacity,
  },
  sendEnabled: {
    backgroundColor: colors.primary,
  },
  sendLabel: {
    ...typeScale.body,
    color: colors.text,
    fontWeight: typeWeight.medium,
  },
  sendLabelEnabled: {
    color: colors.onPrimary,
  },
});
