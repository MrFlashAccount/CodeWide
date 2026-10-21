import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, View, type Text as NativeText } from "react-native";

import { PresentationTextInput } from "../../../presentation/text/ProductText";
import { colors, controlSize, iconSize, radii, spacing, typeScale } from "../../../theme";
import { useEvent } from "../../../react/useEvent";
import { TextShimmer } from "../../../ui/TextShimmer";
import { ActionMenu } from "../../../ui/ActionMenu";
import { AppText as Text } from "../../../ui/Typography";
import type { ScenarioTarget } from "../workspaceCapabilities";
import type { MessageDockTarget } from "./messageDockTarget";

/** The target chip fits "Choose thread" and leaves the one-line placeholder its room at 320dp. */
const TARGET_CHIP_MAX_WIDTH = 140;
/** The send chip reads as inactive until there is text to send. */
const IDLE_CHIP_OPACITY = 0.6;
/** About five body lines before the field scrolls. */
const INPUT_MAX_HEIGHT = 120;

/** Lifecycle of one send: a target was chosen, then the companion answered. */
export type MessageSendLifecycle = {
  readonly onBegin: () => void;
  readonly onSettled: (accepted: boolean) => void;
};

/**
 * Overview dock: a message about this PR to its agent (the `message`
 * scenario). The text stays in the field until the companion accepts the
 * turn, comes back on failure or when no thread was chosen, and a second send
 * is blocked while one is in flight (the chip label shimmers in place). The
 * chip names where it lands. Disabled while the companion is unreachable.
 */
export function PullRequestMessageDock({
  disabled,
  onChoose,
  onSend,
  target,
}: {
  readonly disabled: boolean;
  /** Picks another thread from the chip's long-press menu. */
  readonly onChoose: (target: ScenarioTarget) => void;
  readonly onSend: (text: string, lifecycle: MessageSendLifecycle) => void;
  readonly target: MessageDockTarget;
}): React.JSX.Element {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const blocked = disabled || sending || text.trim().length === 0;
  const send = useEvent((): void => {
    const value = text.trim();
    if (value.length === 0 || disabled || sending) {
      return;
    }
    onSend(value, {
      onBegin: () => {
        setSending(true);
      },
      onSettled: (accepted) => {
        setSending(false);
        if (accepted) {
          setText("");
        }
      },
    });
  });
  return (
    <View style={styles.dock} testID="pull-request-message-dock">
      <PresentationTextInput
        accessibilityLabel="Message about this PR"
        editable={!disabled && !sending}
        multiline
        onChangeText={setText}
        placeholder="Message the agent"
        placeholderTextColor={colors.textDim}
        style={styles.input}
        value={text}
      />
      <TargetChip
        blocked={blocked}
        muted={disabled}
        onChoose={onChoose}
        onSend={send}
        sending={sending}
        target={target}
      />
    </View>
  );
}

/**
 * The send chip names where the message lands. With several linked threads a
 * long press opens the choice; the chosen thread becomes the chip's label.
 */
function TargetChip({
  blocked,
  muted,
  onChoose,
  onSend,
  sending,
  target,
}: {
  readonly blocked: boolean;
  /** Only an unreachable companion mutes the chip; an empty field keeps it readable. */
  readonly muted: boolean;
  readonly onChoose: (target: ScenarioTarget) => void;
  readonly onSend: () => void;
  readonly sending: boolean;
  readonly target: MessageDockTarget;
}): React.JSX.Element {
  const label = useRef<NativeText>(null);
  const chip = (
    <Pressable
      accessibilityHint={
        target.choices.length === 0 ? undefined : "Long press to choose another thread"
      }
      accessibilityLabel={`Send to ${target.label}`}
      accessibilityRole="button"
      accessibilityState={{ busy: sending, disabled: blocked }}
      disabled={blocked && target.choices.length === 0}
      onPress={blocked ? undefined : onSend}
      style={[styles.chip, muted && styles.chipIdle]}
      testID="pull-request-message-target"
    >
      <Ionicons color={colors.text} name="arrow-forward" size={iconSize.indicator} />
      <Text numberOfLines={1} ref={label} style={styles.chipLabel}>
        {target.label}
      </Text>
      <TextShimmer shimmering={sending} target={label} />
    </Pressable>
  );
  if (target.choices.length === 0) {
    return chip;
  }
  return (
    <ActionMenu
      accessibilityLabel="Send to thread"
      actions={target.choices.map((choice) => ({
        id: choiceId(choice.target),
        label: choice.label,
        selected: choice.selected,
      }))}
      onSelect={(id) => {
        const choice = target.choices.find((candidate) => choiceId(candidate.target) === id);
        if (choice !== undefined) {
          onChoose(choice.target);
        }
      }}
      placement="top"
      trigger="long-press"
    >
      {chip}
    </ActionMenu>
  );
}

function choiceId(target: ScenarioTarget): string {
  return target.kind === "newThread" ? "new-thread" : `thread:${target.threadId}`;
}

const styles = StyleSheet.create({
  chip: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.medium,
    columnGap: spacing.xxs,
    flexDirection: "row",
    flexShrink: 1,
    maxWidth: TARGET_CHIP_MAX_WIDTH,
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.sm,
  },
  chipIdle: {
    opacity: IDLE_CHIP_OPACITY,
  },
  chipLabel: {
    ...typeScale.label,
    color: colors.text,
    flexShrink: 1,
  },
  dock: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.composer,
    columnGap: spacing.xs,
    flexDirection: "row",
    margin: spacing.xs,
    paddingLeft: spacing.md,
    paddingRight: spacing.xxs,
    paddingVertical: spacing.xxs,
  },
  input: {
    ...typeScale.body,
    color: colors.text,
    flex: 1,
    maxHeight: INPUT_MAX_HEIGHT,
    minHeight: controlSize.regular,
    // One body line sits centred in the 40dp field, level with the chip.
    paddingVertical: spacing.inputInset,
    textAlignVertical: "center",
  },
});
