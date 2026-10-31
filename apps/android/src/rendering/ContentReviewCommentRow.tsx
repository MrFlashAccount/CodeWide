import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, controlSize, iconSize, radii, spacing, typeScale, typeWeight } from "../theme";
import { useAppDialog } from "../ui/AppDialog";
import { AppText as Text } from "../ui/AppText";
import type { ContentReviewComment } from "./content-review";

const REVIEW_PURPLE = "#B794F6";
const COMMENT_ORDINAL_SIZE = 22;
const DISABLED_OPACITY = 0.4;

export function ContentReviewCommentRow({
  anchorLabel,
  comment,
  index,
  onDelete,
  onEdit,
}: {
  readonly anchorLabel: string;
  readonly comment: ContentReviewComment;
  readonly index: number;
  readonly onDelete: (commentId: string) => Promise<boolean>;
  readonly onEdit: (comment: ContentReviewComment) => void;
}): React.JSX.Element {
  const dialog = useAppDialog();
  const [deleting, setDeleting] = useState(false);
  const edit = useEvent(() => {
    onEdit(comment);
  });
  const remove = useEvent(async () => {
    if (deleting) {
      return;
    }
    setDeleting(true);
    const result = await onDelete(comment.id).then(
      (deleted) => ({ deleted, error: null }),
      (error: unknown) => ({ deleted: false, error }),
    );
    if (!result.deleted) {
      dialog.alert(
        "Could not delete review comment",
        result.error instanceof Error ? result.error.message : "Review update failed",
      );
    }
    // WHY: Both Promise settlements above are handled; React Compiler cannot lower try/finally here.
    // oxlint-disable-next-line react-doctor/no-loading-flag-reset-outside-finally
    setDeleting(false);
  });
  const confirmDelete = useEvent(() => {
    remove().catch(() => undefined);
  });
  const requestDelete = useEvent(() => {
    if (deleting) {
      return;
    }
    dialog.alert("Delete review comment?", comment.body, [
      { style: "cancel", text: "Cancel" },
      { onPress: confirmDelete, style: "destructive", text: "Delete" },
    ]);
  });
  const ordinal = (
    <View style={styles.ordinal}>
      <Text style={styles.ordinalText}>{index + 1}</Text>
    </View>
  );
  const body = (
    <View style={styles.body}>
      <Text numberOfLines={2} style={styles.anchor}>
        {anchorLabel}
      </Text>
      <Text selectable style={styles.text}>
        {comment.body}
      </Text>
    </View>
  );
  const editIcon = (
    <Ionicons color={colors.textMuted} name="pencil-outline" size={iconSize.inline} />
  );
  const deleteIcon = <Ionicons color={colors.red} name="trash-outline" size={iconSize.inline} />;
  const actions = (
    <View style={styles.actions}>
      <Pressable
        accessibilityLabel={`Edit review comment ${String(index + 1)}`}
        accessibilityRole="button"
        disabled={deleting}
        onPress={edit}
        style={styles.action}
      >
        {editIcon}
      </Pressable>
      <Pressable
        accessibilityLabel={`Delete review comment ${String(index + 1)}`}
        accessibilityRole="button"
        disabled={deleting}
        onPress={requestDelete}
        style={styles.action}
      >
        {deleteIcon}
      </Pressable>
    </View>
  );
  return (
    <View style={[styles.row, deleting && styles.disabled]}>
      {ordinal}
      {body}
      {actions}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    height: controlSize.compact,
    justifyContent: "center",
    width: controlSize.compact,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.optical,
  },
  anchor: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  body: {
    flex: 1,
    gap: spacing.optical,
    minWidth: 0,
  },
  disabled: { opacity: DISABLED_OPACITY },
  ordinal: {
    alignItems: "center",
    backgroundColor: REVIEW_PURPLE,
    borderRadius: radii.pill,
    height: COMMENT_ORDINAL_SIZE,
    justifyContent: "center",
    width: COMMENT_ORDINAL_SIZE,
  },
  ordinalText: {
    color: "#0b0b0b",
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  row: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.xs,
    minWidth: 0,
    paddingVertical: spacing.xs,
  },
  text: {
    color: colors.text,
    ...typeScale.body,
  },
});
