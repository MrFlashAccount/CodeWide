import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import {
  colors,
  controlSize,
  iconSize,
  radii,
  spacing,
  typeScale,
  typeWeight,
} from "../../../theme";
import { AppSheet } from "../../../ui/AppSheet";
import { AppText as Text } from "../../../ui/Typography";
import type { MessageSendResult } from "../../messageContent/messageContent";
import { MessageReplyInput } from "../../messageContent/MessageReplyInput";

const PRESSED_OPACITY = 0.72;

/**
 * The floating "Comment" pill of Details, GitHub Mobile style. It opens a
 * composer sheet with a Markdown input whose Send publishes one top-level
 * comment through the owner's write; an acknowledged comment closes the
 * sheet, while a refusal or failure keeps it open with the text (and the
 * input's error). Owns only the sheet's visibility.
 */
export function NewCommentButton({
  onSend,
}: {
  readonly onSend: (markdown: string) => Promise<MessageSendResult>;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const send = useEvent(async (markdown: string): Promise<MessageSendResult> => {
    const result = await onSend(markdown);
    if (result.status === "sent") {
      setOpen(false);
    }
    return result;
  });
  return (
    <>
      <Pressable
        accessibilityLabel="Comment on this pull request"
        accessibilityRole="button"
        onPress={() => {
          setOpen(true);
        }}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
        testID="pull-request-comment-button"
      >
        <Ionicons color={colors.text} name="chatbox-outline" size={iconSize.action} />
        <Text style={styles.label}>Comment</Text>
      </Pressable>
      {open ? (
        <AppSheet
          contentProps={{ dismissLabel: "Close the comment" }}
          isOpen
          onOpenChange={(next) => {
            if (!next) {
              setOpen(false);
            }
          }}
        >
          <CommentComposer onSend={send} />
        </AppSheet>
      ) : null}
    </>
  );
}

/** The sheet's heading and the Markdown input whose Send publishes the comment. */
function CommentComposer({
  onSend,
}: {
  readonly onSend: (markdown: string) => Promise<MessageSendResult>;
}): React.JSX.Element {
  return (
    <View style={styles.sheet} testID="pull-request-comment-sheet">
      <Text accessibilityRole="header" style={styles.title}>
        Comment
      </Text>
      <MessageReplyInput
        accessibilityLabel="Comment on this pull request"
        onSend={onSend}
        placeholder="Add a comment…"
        testID="pull-request-new-comment"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    ...typeScale.title,
    color: colors.text,
    fontWeight: typeWeight.medium,
  },
  pill: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    columnGap: spacing.xs,
    flexDirection: "row",
    height: controlSize.touch,
    paddingLeft: spacing.sm,
    paddingRight: spacing.md,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  sheet: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  title: {
    ...typeScale.title,
    color: colors.text,
  },
});
