import { useId, useRef, useState } from "react";

import { useEvent } from "../../../react/useEvent";
import type { ReviewAnchor, ReviewComment } from "../../rendering/review/reviewModel";

export interface ReviewCommentCollection {
  comments: ReviewComment[];
  remove(id: string): void;
  save(anchor: ReviewAnchor, body: string): void;
}

/** Owns an in-progress review comment collection for the lifetime of its route. */
export function useReviewComments(): ReviewCommentCollection {
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const sequence = useRef(0);
  const idPrefix = useId();
  const save = useEvent((anchor: ReviewAnchor, body: string) => {
    sequence.current += 1;
    const order = sequence.current;
    setComments((current) => [...current, { anchor, body, id: `${idPrefix}:${order}`, order }]);
  });
  const remove = useEvent((id: string) => {
    setComments((current) => current.filter((comment) => comment.id !== id));
  });
  return { comments, remove, save };
}
