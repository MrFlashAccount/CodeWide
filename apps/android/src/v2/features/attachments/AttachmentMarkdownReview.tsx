import type { V2Attachment } from "@codewide/sync-client/v2";
import { useId, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import type { DocumentViewerPreferences } from "../../application/ports/documentViewerPreferenceStore";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ResponseReviewView } from "../../presentation/review/ResponseReviewView";
import type { ContentReviewAnchor } from "../../rendering/renderingCapabilities";
import type { ReviewAnchor, ReviewTarget } from "../../rendering/review/reviewModel";
import { contentReviewAnchor } from "../review/contentReviewAnchor";
import {
  ContentReviewSurfaceProvider,
  contentReviewDiagramCapability,
} from "../review/ContentReviewSurface";
import { ReviewCommentEditor } from "../review/ReviewCommentEditor";
import { submitReviewFeedback } from "../review/reviewSubmission";
import { useReviewComments } from "../review/useReviewComments";
import {
  DEFAULT_DOCUMENT_VIEWER_PREFERENCES,
  documentReadingWidth,
} from "./documentViewerPreferences";

interface AttachmentMarkdownReviewProps {
  attachment: V2Attachment;
  onSubmitted(): void;
  owner: QualifiedThread;
  readerPreferences?: DocumentViewerPreferences;
  source: string;
  truncated: boolean;
}

const REVIEW_TEXT = {
  commentAction: "Comment on entire document",
  submitAction: "Send review",
  subtitle: "Long-press text to attach a comment",
  title: "Review attachment",
} as const;

/** Applies the ordinary V2 review-comment workflow to a Markdown attachment. */
export function AttachmentMarkdownReview(props: AttachmentMarkdownReviewProps): React.JSX.Element {
  const {
    attachment,
    onSubmitted,
    owner,
    readerPreferences = DEFAULT_DOCUMENT_VIEWER_PREFERENCES,
    source,
    truncated,
  } = props;
  const runtime = useV2Runtime();
  const [selectedAnchor, setSelectedAnchor] = useState<ReviewAnchor | null>(null);
  const comments = useReviewComments();
  const submissionSequence = useRef(0);
  const idPrefix = useId();
  const target = attachmentReviewTarget(attachment);
  const beginReview = useEvent((anchor: ContentReviewAnchor) => {
    if (anchor.targetId === target.id) setSelectedAnchor(contentReviewAnchor(anchor, target));
  });
  const commentOnDocument = useEvent(() => setSelectedAnchor({ kind: "response", target }));
  const saveComment = useEvent((anchor: ReviewAnchor, body: string) => {
    comments.save(anchor, body);
    setSelectedAnchor(null);
  });
  const cancelComment = useEvent(() => setSelectedAnchor(null));
  const diagramReview = contentReviewDiagramCapability(comments.comments, selectedAnchor);
  const submit = useEvent(async (): Promise<void> => {
    submissionSequence.current += 1;
    await submitReviewFeedback({
      attachments: runtime.composerAttachments,
      commands: runtime.commands,
      comments: comments.comments,
      draftId: `attachment-review:${idPrefix}:${String(submissionSequence.current)}`,
      owner,
    });
    onSubmitted();
  });
  return (
    <ContentReviewSurfaceProvider
      comments={comments.comments}
      onCancel={cancelComment}
      onRemove={comments.remove}
      onSave={saveComment}
      owner={owner}
      selectedAnchor={selectedAnchor}
    >
      <View style={styles.root}>
        <ResponseReviewView
          comments={comments.comments}
          {...(readerPreferences.layoutMode === "reading"
            ? { contentMaxWidth: documentReadingWidth(readerPreferences.textScale) }
            : {})}
          diagramReview={diagramReview}
          {...(truncated
            ? { notice: "Preview is truncated. Save the attachment to read the complete file." }
            : {})}
          onBeginReview={beginReview}
          onClose={onSubmitted}
          onCommentOnResponse={commentOnDocument}
          onRemoveComment={comments.remove}
          onSubmit={submit}
          response={source}
          target={target}
          text={REVIEW_TEXT}
          textScale={readerPreferences.textScale}
        />
        {selectedAnchor === null || selectedAnchor.kind === "diagram" ? null : (
          <ReviewCommentEditor
            anchor={selectedAnchor}
            onCancel={cancelComment}
            onSave={saveComment}
            owner={owner}
          />
        )}
      </View>
    </ContentReviewSurfaceProvider>
  );
}

function attachmentReviewTarget(attachment: V2Attachment): ReviewTarget {
  return {
    id: `attachment-document:${attachment.id}`,
    label: attachment.name,
    reference: attachment.downloadUrl,
  };
}

const styles = StyleSheet.create({ root: { flex: 1, minHeight: 0 } });
