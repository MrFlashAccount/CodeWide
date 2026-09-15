import { useRef, useState } from "react";
import { useEvent } from "../../react/useEvent";
import {
  codeReviewCommentKey,
  type CodeReviewComment,
  type CodeReviewLineReference,
} from "../../rendering/code-review";
import { sameLineReference } from "./reviewLocation";

export function useReviewComments() {
  const selectionRef = useRef({ start: 0, end: 0 });
  const [selectedReference, setSelectedReference] = useState<CodeReviewLineReference | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const commentKey = selectedReference === null ? null : codeReviewCommentKey(selectedReference);
  const commentDraft = commentKey === null ? "" : (commentDrafts[commentKey] ?? "");
  const [comments, setComments] = useState<CodeReviewComment[]>([]);
  const selectLine = useEvent((reference: CodeReviewLineReference) => {
    const sameLine = selectedReference !== null && sameLineReference(selectedReference, reference);
    if (!sameLine) {
      selectionRef.current = { start: 0, end: 0 };
    }
    setSelectedReference(reference);
  });
  const updateReferenceDraft = useEvent((reference: CodeReviewLineReference, value: string) => {
    const key = codeReviewCommentKey(reference);
    setCommentDrafts((current) => ({ ...current, [key]: value }));
  });
  const updateCommentDraft = useEvent((value: string) => {
    if (selectedReference !== null) updateReferenceDraft(selectedReference, value);
  });
  const commitComment = useEvent((reference: CodeReviewLineReference, draft: string) => {
    const body = draft.trim();
    if (body === "") return;
    const committedCommentKey = codeReviewCommentKey(reference);
    setComments((current) => [
      ...current,
      {
        ...reference,
        id: `review-${Date.now().toString(36)}-${current.length}`,
        body,
        createdAt: Date.now(),
      },
    ]);
    setCommentDrafts((current) => ({ ...current, [committedCommentKey]: "" }));
    setSelectedReference((current) =>
      current !== null && sameLineReference(current, reference) ? null : current,
    );
  });
  return {
    selectionRef,
    selectedReference,
    setSelectedReference,
    commentDraft,
    comments,
    setComments,
    selectLine,
    updateCommentDraft,
    updateReferenceDraft,
    commitComment,
  };
}
