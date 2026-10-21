import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, View } from "react-native";

import { colors, iconSize, spacing } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import type { CodeReviewComment } from "../comments/reviewComment";
import { shortPath } from "../resources/reviewLocation";
import { styles } from "./CodeReviewWorkspace.styles";

/** Horizontal strip of the review's local line comments, each removable before attaching. */
export function ReviewCommentStrip({
  comments,
  onDelete,
}: {
  readonly comments: readonly CodeReviewComment[];
  readonly onDelete: (id: string) => void;
}): React.JSX.Element | null {
  if (comments.length === 0) {
    return null;
  }
  return (
    <ScrollView
      contentContainerStyle={styles.commentStripContent}
      horizontal
      keyboardShouldPersistTaps="handled"
      style={styles.commentStrip}
    >
      {comments.map((comment) => (
        <CommentChip comment={comment} key={comment.id} onDelete={onDelete} />
      ))}
    </ScrollView>
  );
}

function CommentChip({
  comment,
  onDelete,
}: {
  readonly comment: CodeReviewComment;
  readonly onDelete: (id: string) => void;
}): React.JSX.Element {
  return (
    <View style={styles.commentChip}>
      <Text numberOfLines={1} style={styles.commentChipLocation}>
        {shortPath(comment.path)}:{comment.line}
      </Text>
      <Text numberOfLines={1} style={styles.commentChipBody}>
        {comment.body}
      </Text>
      <Pressable
        accessibilityLabel="Delete comment"
        hitSlop={spacing.xs}
        onPress={() => {
          onDelete(comment.id);
        }}
      >
        <Ionicons color={colors.textDim} name="close-circle" size={iconSize.inline} />
      </Pressable>
    </View>
  );
}
