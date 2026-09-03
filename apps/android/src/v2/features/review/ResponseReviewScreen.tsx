import { useId, useRef, useState, useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ResourceStateView } from "../../presentation/feedback/ResourceStateView";
import { ResponseReviewView } from "../../presentation/review/ResponseReviewView";
import type { ContentReviewAnchor } from "../../rendering/renderingCapabilities";
import type { ReviewAnchor } from "../../rendering/review/reviewModel";
import { reviewResponseTarget } from "../../rendering/review/reviewModel";
import { ResponseReviewResource } from "./responseReviewResource";
import { ReviewCommentEditor } from "./ReviewCommentEditor";
import {
  ContentReviewSurfaceProvider,
  contentReviewDiagramCapability,
} from "./ContentReviewSurface";
import { contentReviewAnchor } from "./contentReviewAnchor";
import { submitReviewFeedback } from "./reviewSubmission";
import { useReviewComments } from "./useReviewComments";

interface ResponseReviewScreenProps {
  itemId: string;
  onClose(): void;
  owner: QualifiedThread;
  turnId: string;
}

export function ResponseReviewScreen(props: ResponseReviewScreenProps): React.JSX.Element {
  const { itemId, owner, turnId } = props;
  const runtime = useV2Runtime();
  const [resource] = useState(
    () =>
      new ResponseReviewResource({
        itemId,
        queries: runtime.queries,
        savedServerId: owner.savedServerId,
        threadId: owner.threadId,
        turnId,
      }),
  );
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const retry = useEvent(() => {
    resource.refresh().catch(() => undefined);
  });
  if (snapshot.value === null) {
    return (
      <ResourceStateView
        message={snapshot.status === "error" ? snapshot.message : "Reading response…"}
        onRetry={retry}
        status={snapshot.status === "error" ? "error" : "loading"}
      />
    );
  }
  return <LoadedResponseReview {...props} response={snapshot.value} />;
}

interface LoadedResponseReviewProps extends ResponseReviewScreenProps {
  response: string;
}

function LoadedResponseReview(props: LoadedResponseReviewProps): React.JSX.Element {
  const { itemId, onClose, owner, response, turnId } = props;
  const runtime = useV2Runtime();
  const [selectedAnchor, setSelectedAnchor] = useState<ReviewAnchor | null>(null);
  const commentCollection = useReviewComments();
  const submissionSequence = useRef(0);
  const idPrefix = useId();
  const target = reviewResponseTarget(turnId, itemId);
  const beginReview = useEvent((anchor: ContentReviewAnchor) => {
    if (anchor.targetId === target.id) setSelectedAnchor(contentReviewAnchor(anchor, target));
  });
  const commentOnResponse = useEvent(() => setSelectedAnchor({ kind: "response", target }));
  const saveComment = useEvent((anchor: ReviewAnchor, body: string) => {
    commentCollection.save(anchor, body);
    setSelectedAnchor(null);
  });
  const clearSelectedAnchor = useEvent(() => setSelectedAnchor(null));
  const diagramReview = contentReviewDiagramCapability(commentCollection.comments, selectedAnchor);
  const submit = useEvent(async () => {
    submissionSequence.current += 1;
    await submitReviewFeedback({
      attachments: runtime.composerAttachments,
      commands: runtime.commands,
      comments: commentCollection.comments,
      draftId: `response-review:${idPrefix}:${submissionSequence.current}`,
      owner,
    });
    onClose();
  });
  return (
    <ContentReviewSurfaceProvider
      comments={commentCollection.comments}
      onCancel={clearSelectedAnchor}
      onRemove={commentCollection.remove}
      onSave={saveComment}
      owner={owner}
      selectedAnchor={selectedAnchor}
    >
      <View style={styles.root}>
        <ResponseReviewView
          comments={commentCollection.comments}
          diagramReview={diagramReview}
          onBeginReview={beginReview}
          onClose={onClose}
          onCommentOnResponse={commentOnResponse}
          onRemoveComment={commentCollection.remove}
          onSubmit={submit}
          response={response}
          target={target}
        />
        {selectedAnchor === null || selectedAnchor.kind === "diagram" ? null : (
          <ReviewCommentEditor
            anchor={selectedAnchor}
            onCancel={clearSelectedAnchor}
            onSave={saveComment}
            owner={owner}
          />
        )}
      </View>
    </ContentReviewSurfaceProvider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, minHeight: 0 } });
