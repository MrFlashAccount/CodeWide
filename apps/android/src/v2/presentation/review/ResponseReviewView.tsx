import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEvent } from "../../../react/useEvent";
import { colors, spacing, touchTarget, typeScale } from "../../theme";
import type {
  ContentReviewAnchor,
  DiagramReviewCapability,
} from "../../rendering/renderingCapabilities";
import { V2RenderingCapabilityProvider } from "../../rendering/renderingCapabilities";
import { RichMarkdown } from "../../rendering/RichMarkdown";
import type { ReviewComment, ReviewTarget } from "../../rendering/review/reviewModel";
import { ActionPressable } from "../../ui/actions/ActionPressable";
import { ProductText } from "../text/ProductText";
import { ProductTextScaleProvider } from "../text/TextScaleContext";
import { ReviewCommentStrip } from "./ReviewCommentStrip";

interface ResponseReviewViewProps {
  comments: ReviewComment[];
  contentMaxWidth?: number;
  diagramReview?: DiagramReviewCapability;
  notice?: string;
  onBeginReview(anchor: ContentReviewAnchor): void;
  onClose(): void;
  onCommentOnResponse(): void;
  onRemoveComment(id: string): void;
  onSubmit(): Promise<void>;
  response: string;
  target: ReviewTarget;
  text?: ResponseReviewText;
  textScale?: number;
}

interface ResponseReviewText {
  commentAction: string;
  submitAction: string;
  subtitle: string;
  title: string;
}

const DEFAULT_TEXT: ResponseReviewText = {
  commentAction: "Comment on entire response",
  submitAction: "Submit",
  subtitle: "Long-press text to attach a comment",
  title: "Review response",
};

export function ResponseReviewView(props: ResponseReviewViewProps): React.JSX.Element {
  const {
    comments,
    contentMaxWidth,
    diagramReview,
    notice,
    onBeginReview,
    onClose,
    onCommentOnResponse,
    onRemoveComment,
    onSubmit,
    response,
    target,
    text = DEFAULT_TEXT,
    textScale = 1,
  } = props;
  const insets = useSafeAreaInsets();
  const beginReview = useEvent((anchor: ContentReviewAnchor) => onBeginReview(anchor));
  const close = useEvent(async () => onClose());
  const commentOnResponse = useEvent(async () => onCommentOnResponse());
  const renderingCapabilities = {
    beginReview,
    ...(diagramReview === undefined ? {} : { diagramReview }),
  };
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ActionPressable action={{ id: "close-response-review", label: "Close", run: close }} />
        <View style={styles.titleBlock}>
          <ProductText numberOfLines={1} style={styles.title} weight="semibold">
            {text.title}
          </ProductText>
          <ProductText numberOfLines={1} style={styles.subtitle} tone="dim">
            {text.subtitle}
          </ProductText>
        </View>
        <ActionPressable
          action={{
            disabled: comments.length === 0,
            id: "submit-response-review",
            label: text.submitAction,
            run: onSubmit,
          }}
        />
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          contentMaxWidth === undefined ? null : { maxWidth: contentMaxWidth },
        ]}
      >
        <V2RenderingCapabilityProvider capabilities={renderingCapabilities}>
          <ProductTextScaleProvider scale={textScale}>
            <RichMarkdown reviewTargetId={target.id} source={response} />
          </ProductTextScaleProvider>
        </V2RenderingCapabilityProvider>
        {notice === undefined ? null : (
          <ProductText accessibilityLiveRegion="polite" tone="warning">
            {notice}
          </ProductText>
        )}
        <ActionPressable
          action={{
            id: "comment-on-entire-response",
            label: text.commentAction,
            run: commentOnResponse,
          }}
        />
      </ScrollView>
      <ReviewCommentStrip comments={comments} onRemove={onRemoveComment} />
      <View accessibilityElementsHidden style={[styles.safeBottom, { height: insets.bottom }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    alignSelf: "center",
    gap: spacing.lg,
    maxWidth: 860,
    padding: spacing.md,
    width: "100%",
  },
  header: {
    alignItems: "center",
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 58,
    paddingHorizontal: spacing.xs,
  },
  root: { backgroundColor: colors.background, flex: 1, minHeight: 0 },
  safeBottom: { backgroundColor: colors.background, flexShrink: 0 },
  subtitle: { ...typeScale.caption },
  title: { ...typeScale.title },
  titleBlock: { flex: 1, minWidth: 0, paddingHorizontal: touchTarget / 4 },
});
