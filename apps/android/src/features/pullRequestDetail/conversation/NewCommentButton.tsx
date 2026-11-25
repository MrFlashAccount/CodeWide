import { useSelector } from "@legendapp/state/react";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet } from "react-native";

import type { CommentAttachment } from "../../../data/forgeCommentAttachment";
import { useConstant } from "../../../react/useConstant";
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
import { createCommentDraft } from "./commentDraft";
import { CommentComposer } from "./CommentComposer";

const PRESSED_OPACITY = 0.72;

/** Opens the PR's Markdown editor. Its draft belongs to the mounted PR. */
export function NewCommentButton({
  onSend,
  onUpload,
}: {
  readonly onSend: (markdown: string) => Promise<MessageSendResult>;
  readonly onUpload: ((file: CommentAttachment) => Promise<string>) | null;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const draft = useConstant(createCommentDraft);
  const canDismiss = useSelector(() => draft.state.status.get() !== "sending");
  const show = useEvent(() => {
    setOpen(true);
  });
  const done = useEvent(() => {
    setOpen(false);
  });
  const dismiss = useEvent((next: boolean) => {
    if (!next && !draft.busy()) {
      setOpen(false);
    }
  });
  return (
    <>
      <Pressable
        accessibilityLabel="Comment on this pull request"
        accessibilityRole="button"
        onPress={show}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
        testID="pull-request-comment-button"
      >
        <Ionicons color={colors.text} name="chatbox-outline" size={iconSize.action} />
        <Text style={styles.label}>Comment</Text>
      </Pressable>
      {open ? (
        <AppSheet
          contentProps={{
            dismissLabel: "Close the comment",
            enableDynamicSizing: false,
            enablePanDownToClose: canDismiss,
            snapPoints: ["100%"],
          }}
          isOpen
          onOpenChange={dismiss}
        >
          <CommentComposer draft={draft} onDone={done} onSend={onSend} onUpload={onUpload} />
        </AppSheet>
      ) : null}
    </>
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
});
