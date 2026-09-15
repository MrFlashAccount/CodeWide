import type { ReviewDelivery, ReviewTarget } from "@codewide/codex-protocol/v0.147.0/v2";
/** Qualified review operations; transport and persisted state stay with their existing lower owners. */
export type ReviewWorkspaceCapabilities = {
  startReview(
    connectionId: string,
    threadId: string,
    target: ReviewTarget,
    delivery: ReviewDelivery,
  ): Promise<string>;
};
