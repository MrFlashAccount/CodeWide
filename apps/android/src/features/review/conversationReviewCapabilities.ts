import type { ReviewDelivery, ReviewTarget } from "@codewide/codex-protocol/v0.155.1/v2";
/** Qualified capabilities consumed by the review owner in conversation composition. */
export type ConversationReviewCapabilities = {
  onStartReview: ((target: ReviewTarget, delivery: ReviewDelivery) => Promise<string>) | undefined;
};
