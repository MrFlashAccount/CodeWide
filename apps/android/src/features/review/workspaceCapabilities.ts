import type { ReviewDelivery, ReviewTarget } from "@codewide/codex-protocol/v0.155.1/v2";
/** Qualified review operations; transport and persisted state stay with their existing lower owners. */
export type ReviewWorkspaceCapabilities = {
  // WHY: This extracted V1 signature is shared by existing callers; changing its call shape would expand this behavior-preserving cleanup into an API migration.
  // oxlint-disable-next-line eslint/max-params
  startReview: (
    connectionId: string,
    threadId: string,
    target: ReviewTarget,
    delivery: ReviewDelivery,
  ) => Promise<string>;
};
