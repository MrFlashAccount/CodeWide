import { createContext, type ReactNode, useContext } from "react";
import { StyleSheet, View } from "react-native";

import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ReviewCommentStrip } from "../../presentation/review/ReviewCommentStrip";
import type {
  DiagramReviewCapability,
  DiagramReviewComposerProps,
  DiagramReviewOverlayProps,
  DiagramReviewPoint,
} from "../../rendering/renderingCapabilities";
import type { ReviewAnchor, ReviewComment } from "../../rendering/review/reviewModel";
import { ReviewCommentEditor } from "./ReviewCommentEditor";

interface ContentReviewSurfaceProviderProps {
  children: ReactNode;
  comments: readonly ReviewComment[];
  onCancel(): void;
  onRemove(id: string): void;
  onSave(anchor: ReviewAnchor, body: string): void;
  owner: QualifiedThread;
  selectedAnchor: ReviewAnchor | null;
}

interface ContentReviewSurfaceContextValue {
  comments: readonly ReviewComment[];
  onCancel(): void;
  onRemove(id: string): void;
  onSave(anchor: ReviewAnchor, body: string): void;
  owner: QualifiedThread;
  selectedAnchor: ReviewAnchor | null;
}

const ContentReviewSurfaceContext = createContext<ContentReviewSurfaceContextValue | null>(null);

/** Shares route-owned review state with renderer-owned fullscreen overlays. */
export function ContentReviewSurfaceProvider(
  props: ContentReviewSurfaceProviderProps,
): React.JSX.Element {
  const { children, ...value } = props;
  return (
    <ContentReviewSurfaceContext.Provider value={value}>
      {children}
    </ContentReviewSurfaceContext.Provider>
  );
}

/** Builds the declarative rendering port without moving review ownership into the renderer. */
export function contentReviewDiagramCapability(
  comments: readonly ReviewComment[],
  selectedAnchor: ReviewAnchor | null,
): DiagramReviewCapability {
  return {
    Comments: ContentReviewComments,
    Composer: ContentReviewComposer,
    points: contentReviewDiagramPoints(comments, selectedAnchor),
  };
}

function ContentReviewComments(props: DiagramReviewOverlayProps): React.JSX.Element | null {
  const { bottomOffset, diagramId, targetId } = props;
  const review = useContentReviewSurface();
  const comments = review.comments.filter((comment) =>
    matchesDiagram(comment.anchor, targetId, diagramId),
  );
  const editing = matchesDiagram(review.selectedAnchor, targetId, diagramId);
  if (comments.length === 0 || editing) return null;
  return (
    <View pointerEvents="box-none" style={[styles.comments, { bottom: bottomOffset }]}>
      <ReviewCommentStrip comments={comments} onRemove={review.onRemove} />
    </View>
  );
}

function ContentReviewComposer(props: DiagramReviewComposerProps): React.JSX.Element | null {
  const { diagramId, targetId } = props;
  const review = useContentReviewSurface();
  const { selectedAnchor } = review;
  if (!matchesDiagram(selectedAnchor, targetId, diagramId)) return null;
  return (
    <ReviewCommentEditor
      anchor={selectedAnchor}
      onCancel={review.onCancel}
      onSave={review.onSave}
      owner={review.owner}
    />
  );
}

function contentReviewDiagramPoints(
  comments: readonly ReviewComment[],
  selectedAnchor: ReviewAnchor | null,
): readonly DiagramReviewPoint[] {
  const points = comments.flatMap((comment) => {
    const { anchor } = comment;
    return anchor.kind === "diagram" ? [diagramReviewPoint(comment.id, anchor, false)] : [];
  });
  return selectedAnchor?.kind === "diagram"
    ? [...points, diagramReviewPoint("pending-diagram-review", selectedAnchor, true)]
    : points;
}

function diagramReviewPoint(
  id: string,
  anchor: Extract<ReviewAnchor, { kind: "diagram" }>,
  pending: boolean,
): DiagramReviewPoint {
  return {
    diagramId: anchor.diagramId,
    id,
    pending,
    targetId: anchor.target.id,
    x: anchor.x,
    y: anchor.y,
  };
}

function matchesDiagram(
  anchor: ReviewAnchor | null,
  targetId: string,
  diagramId: string,
): anchor is Extract<ReviewAnchor, { kind: "diagram" }> {
  return (
    anchor?.kind === "diagram" && anchor.target.id === targetId && anchor.diagramId === diagramId
  );
}

function useContentReviewSurface(): ContentReviewSurfaceContextValue {
  const value = useContext(ContentReviewSurfaceContext);
  if (value === null) throw new Error("Content review surface is unavailable");
  return value;
}

const styles = StyleSheet.create({
  comments: {
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 80,
  },
});
