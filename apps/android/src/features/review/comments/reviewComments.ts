import { useRef, useState } from "react";
import { useEvent } from "../../../react/useEvent";
import {
  codeReviewCommentKey,
  type CodeReviewComment,
  type CodeReviewLineReference,
} from "./reviewComment";
import { sameLineReference } from "../resources/reviewLocation";

export function useReviewComments() {
  const selectionRef = useRef({ end: 0, start: 0 });
  const [selectedReference, setSelectedReference] = useState<CodeReviewLineReference | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const commentKey = selectedReference === null ? null : codeReviewCommentKey(selectedReference);
  const commentDraft = commentKey === null ? "" : (commentDrafts[commentKey] ?? "");
  const [comments, setComments] = useState<CodeReviewComment[]>([]);
  const selectLine = useEvent((reference: CodeReviewLineReference) => {
    const sameLine = selectedReference !== null && sameLineReference(selectedReference, reference);
    if (!sameLine) {
      selectionRef.current = { end: 0, start: 0 };
    }
    setSelectedReference(reference);
  });
  const updateReferenceDraft = useEvent((reference: CodeReviewLineReference, value: string) => {
    const key = codeReviewCommentKey(reference);
    setCommentDrafts((current) => ({ ...current, [key]: value }));
  });
  const updateCommentDraft = useEvent((value: string) => {
    if (selectedReference !== null) {
      updateReferenceDraft(selectedReference, value);
    }
  });
  const commitComment = useEvent((reference: CodeReviewLineReference, draft: string) => {
    const body = draft.trim();
    if (body === "") {
      return;
    }
    const committedCommentKey = codeReviewCommentKey(reference);
    setComments((current) => [
      ...current,
      {
        ...reference,
        body,
        createdAt: Date.now(),
        id: `review-${Date.now().toString(36)}-${String(current.length)}`,
      },
    ]);
    setCommentDrafts((current) => ({ ...current, [committedCommentKey]: "" }));
    setSelectedReference((current) =>
      current !== null && sameLineReference(current, reference) ? null : current,
    );
  });
  return {
    commentDraft,
    comments,
    commitComment,
    selectedReference,
    selectionRef,
    selectLine,
    setComments,
    setSelectedReference,
    updateCommentDraft,
    updateReferenceDraft,
  };
}
