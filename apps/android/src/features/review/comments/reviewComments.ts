import { useState } from "react";
import { useEvent } from "../../../react/useEvent";
import type { CodeReviewComment, CodeReviewLineReference } from "./reviewComment";
import { sameLineReference } from "../resources/reviewLocation";

/**
 * The session/VCS review's local line comments and the line whose composer is
 * open. Unsent text lives in the line composer's own per-line owner.
 */
export function useReviewComments() {
  const [selectedReference, setSelectedReference] = useState<CodeReviewLineReference | null>(null);
  const [comments, setComments] = useState<CodeReviewComment[]>([]);
  const selectLine = useEvent((reference: CodeReviewLineReference) => {
    setSelectedReference(reference);
  });
  /** Adds a comment to its captured line; another line's open composer stays open. */
  const commitComment = useEvent((reference: CodeReviewLineReference, draft: string) => {
    const body = draft.trim();
    if (body === "") {
      return;
    }
    setComments((current) => [
      ...current,
      {
        ...reference,
        body,
        createdAt: Date.now(),
        id: `review-${Date.now().toString(36)}-${String(current.length)}`,
      },
    ]);
    setSelectedReference((current) =>
      current !== null && sameLineReference(current, reference) ? null : current,
    );
  });
  return {
    comments,
    commitComment,
    selectedReference,
    selectLine,
    setComments,
    setSelectedReference,
  };
}
