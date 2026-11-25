import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";

import { colors, iconSize } from "../../../theme";
import { AppSheet, AppSheetScrollView } from "../../../ui/AppSheet";
import { AppText as Text } from "../../../ui/Typography";
import type { CodeReviewComment } from "../comments/reviewComment";
import { shortPath } from "../resources/reviewLocation";
import { styles } from "./CodeReviewWorkspace.styles";

/** Local review notes can be reopened at their line or attached together to the chat. */
export function ReviewCommentsSheet(props: {
  readonly comments: readonly CodeReviewComment[];
  readonly disabled: boolean;
  readonly onAttach: () => void;
  readonly onDelete: (id: string) => void;
  readonly onEdit: (comment: CodeReviewComment) => void;
  readonly onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  return (
    <AppSheet
      contentProps={{ enableDynamicSizing: false, snapPoints: ["60%", "92%"] }}
      isOpen
      onOpenChange={props.onOpenChange}
    >
      <ReviewHeader
        count={props.comments.length}
        disabled={props.disabled}
        onAttach={props.onAttach}
      />
      <AppSheetScrollView>
        {props.comments.length === 0 && (
          <Text style={styles.hint}>Tap a line in the diff to add a comment.</Text>
        )}
        {props.comments.map((comment) => (
          <CommentRow
            comment={comment}
            key={comment.id}
            onDelete={props.onDelete}
            onEdit={props.onEdit}
          />
        ))}
      </AppSheetScrollView>
    </AppSheet>
  );
}

function ReviewHeader(props: {
  readonly count: number;
  readonly disabled: boolean;
  readonly onAttach: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.sheetHeader}>
      <Text style={styles.sheetTitle}>Review · {props.count}</Text>
      <Pressable
        accessibilityLabel="Attach review"
        accessibilityRole="button"
        disabled={props.disabled}
        onPress={props.onAttach}
        style={[styles.attachButton, props.disabled && styles.disabled]}
      >
        <Text style={styles.attachLabel}>Attach to chat</Text>
      </Pressable>
    </View>
  );
}

function CommentRow({
  comment,
  onDelete,
  onEdit,
}: {
  readonly comment: CodeReviewComment;
  readonly onDelete: (id: string) => void;
  readonly onEdit: (comment: CodeReviewComment) => void;
}): React.JSX.Element {
  return (
    <View style={styles.noteRow}>
      <Pressable
        accessibilityLabel={`Edit comment on ${comment.path} line ${String(comment.line)}`}
        accessibilityRole="button"
        onPress={() => {
          onEdit(comment);
        }}
        style={styles.note}
      >
        <Text style={styles.location}>
          {shortPath(comment.path)} · {comment.side === "old" ? "old line" : "line"} {comment.line}
        </Text>
        <Text style={styles.body}>{comment.body}</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Delete comment"
        accessibilityRole="button"
        onPress={() => {
          onDelete(comment.id);
        }}
        style={styles.iconButton}
      >
        <Ionicons color={colors.textMuted} name="trash-outline" size={iconSize.inline} />
      </Pressable>
    </View>
  );
}
