import type { ContentReviewAnchor } from "../../rendering/renderingCapabilities";
import type { ReviewAnchor, ReviewTarget } from "../../rendering/review/reviewModel";

/** Converts renderer coordinates into the transport-neutral review anchor model. */
export function contentReviewAnchor(
  anchor: ContentReviewAnchor,
  target: ReviewTarget,
): ReviewAnchor {
  if (anchor.kind === "text") {
    return {
      blockPath: anchor.blockPath,
      end: anchor.end,
      kind: "text",
      quote: anchor.quote,
      start: anchor.start,
      target,
    };
  }
  return {
    diagramId: anchor.diagramId,
    kind: "diagram",
    source: anchor.source,
    target,
    x: anchor.x,
    y: anchor.y,
  };
}
