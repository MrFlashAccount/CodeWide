import type { ConfirmLevel } from "../../data/forgeActionCatalog";
import type { AttentionRevision, HeadRevision, PullRequestKey } from "../../data/forgeContract";
import type { ActionRunResult, SubmitOutcome, ViewedMark } from "../../data/forgeMutationContract";
import type { LinkedThread } from "../../data/forgePullRequestContract";
import type { DraftId, ThreadId } from "../../data/reviewContract";

/** Agent scenario kinds; `message` is the Overview dock. */
export type ScenarioKind = "addressComments" | "fixCi" | "message" | "rebase" | "reviewPr";

/** Where a scenario or guide continues: an existing linked thread or a new one. */
export type ScenarioTarget =
  | { readonly kind: "newThread" }
  | { readonly kind: "thread"; readonly threadId: ThreadId };

/** PR identity carried by every PR mutation. */
export type PullRequestTarget = {
  readonly connectionId: string;
  readonly headRevision: HeadRevision;
  readonly pullRequest: PullRequestKey;
};

/**
 * Forge writes and agent starts of the PR screen. Each forge write has one
 * trigger, carries the head revision, and is acknowledged by the companion;
 * replay-safe writes enter the persisted TanStack mutation queue before their
 * first RPC. Each idempotency key is generated per user tap and survives replay.
 */
export type PullRequestDetailWorkspaceCapabilities = {
  readonly ensureReviewChat: (
    target: Omit<PullRequestTarget, "headRevision">,
  ) => Promise<{ readonly created: boolean; readonly threadId: ThreadId }>;
  readonly markAttentionSeen: (target: {
    readonly connectionId: string;
    readonly pullRequest: PullRequestKey;
    readonly revision: AttentionRevision;
  }) => Promise<void>;
  readonly runAction: (
    target: PullRequestTarget,
    request: {
      readonly actionId: string;
      readonly confirmation: ConfirmLevel;
      readonly idempotencyKey: string;
      readonly input: boolean | string | null;
    },
  ) => Promise<ActionRunResult>;
  readonly setLink: (
    target: Omit<PullRequestTarget, "headRevision">,
    threadId: ThreadId,
    linked: boolean,
  ) => Promise<readonly LinkedThread[]>;
  readonly setViewed: (
    target: PullRequestTarget,
    path: string,
    viewed: boolean,
  ) => Promise<ViewedMark>;
  readonly startScenario: (
    target: PullRequestTarget,
    request: {
      readonly checkId: string | null;
      readonly idempotencyKey: string;
      readonly scenario: ScenarioKind;
      readonly target: ScenarioTarget;
      readonly text: string | null;
    },
  ) => Promise<{ readonly created: boolean; readonly threadId: ThreadId }>;
  readonly submitReview: (
    target: PullRequestTarget,
    request: {
      readonly body: string | null;
      readonly draftIds: readonly DraftId[];
      readonly forwardBothToAgent: boolean;
      readonly idempotencyKey: string;
      readonly verdictActionId: string;
    },
  ) => Promise<SubmitOutcome>;
};
