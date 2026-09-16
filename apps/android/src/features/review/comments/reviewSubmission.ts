import { createTextUpload, type SelectedUpload } from "../../../native/file-transfer";
import { useEvent } from "../../../react/useEvent";
import { serializeCodeReviewAttachment, type CodeReviewComment } from "./reviewComment";

/** Composer owns admission and acknowledgement; review prepares the existing attachment content. */
export type ReviewFileAdmission = {
  admitCodeReview: (selected: SelectedUpload) => Promise<boolean>;
  admitContentReview: (selected: SelectedUpload) => Promise<string | null>;
};

export function useReviewSubmission(admission: ReviewFileAdmission) {
  const attachCodeReview = useEvent(
    async (comments: readonly CodeReviewComment[]): Promise<boolean> => {
      if (comments.length === 0) {
        return false;
      }
      const selected = createTextUpload(
        `codex-review-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.md`,
        "text/markdown",
        serializeCodeReviewAttachment(comments),
      );
      return admission.admitCodeReview(selected);
    },
  );
  const attachContentReview = useEvent(async (markdown: string): Promise<string | null> => {
    if (markdown === "") {
      return null;
    }
    const selected = createTextUpload(
      `codex-content-review-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.md`,
      "text/markdown",
      markdown,
    );
    return admission.admitContentReview(selected);
  });
  return { attachCodeReview, attachContentReview };
}
