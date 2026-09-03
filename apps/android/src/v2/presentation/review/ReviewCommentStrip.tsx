import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, typeScale } from "../../theme";
import type { ReviewComment } from "../../rendering/review/reviewModel";
import { ProductText } from "../text/ProductText";

interface ReviewCommentStripProps {
  comments: ReviewComment[];
  onRemove(id: string): void;
}

interface ReviewCommentChipProps {
  comment: ReviewComment;
  onRemove(id: string): void;
}

export function ReviewCommentStrip(props: ReviewCommentStripProps): React.JSX.Element | null {
  const { comments, onRemove } = props;
  if (comments.length === 0) return null;
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      horizontal
      keyboardShouldPersistTaps="handled"
      style={styles.root}
    >
      {comments.map((comment) => (
        <ReviewCommentChip key={comment.id} comment={comment} onRemove={onRemove} />
      ))}
    </ScrollView>
  );
}

function ReviewCommentChip(props: ReviewCommentChipProps): React.JSX.Element {
  const { comment, onRemove } = props;
  const remove = useEvent(() => onRemove(comment.id));
  return (
    <View style={styles.chip}>
      <ProductText numberOfLines={1} style={styles.location}>
        {commentLocation(comment)}
      </ProductText>
      <ProductText numberOfLines={1} style={styles.body}>
        {comment.body}
      </ProductText>
      <Pressable accessibilityLabel="Delete review comment" hitSlop={8} onPress={remove}>
        <Ionicons color={colors.textDim} name="close-circle" size={18} />
      </Pressable>
    </View>
  );
}

function commentLocation(comment: ReviewComment): string {
  const { anchor } = comment;
  if (anchor.kind === "line") return `${shortPath(anchor.path)}:${anchor.line}`;
  if (anchor.kind === "text") return "Selected text";
  if (anchor.kind === "diagram") return "Diagram point";
  return "Response";
}

function shortPath(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  const short = parts.slice(-2).join("/");
  return short === "" ? path : short;
}

const styles = StyleSheet.create({
  body: { color: colors.text, flexShrink: 1, ...typeScale.label },
  chip: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: spacing.xs,
    maxWidth: 320,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  content: {
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  location: { color: colors.accent, flexShrink: 0, ...typeScale.caption },
  root: { backgroundColor: colors.surface, flexGrow: 0, maxHeight: 56 },
});
