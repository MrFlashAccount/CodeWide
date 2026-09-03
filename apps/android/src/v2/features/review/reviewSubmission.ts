import type {
  V2Command,
  V2CommandTerminalFrame,
  V2InputBlock,
  V2ReviewTarget,
} from "@codewide/sync-client/v2";

import type {
  CommandCorrelationScope,
  CommandSettlement,
} from "../../application/commandCorrelation";
import type { ComposerAttachmentDraftScope } from "../../application/composer/composerAttachmentController";
import type { ComposerAttachmentTarget } from "../../application/ports/composerAttachmentTransport";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { serializeReviewFeedback } from "../../rendering/review/reviewSerialization";
import type {
  ReviewComment,
  ReviewDelivery,
  ReviewStartTarget,
} from "../../rendering/review/reviewModel";

/** @testOnly Defines the injectable command port used by review regression fakes. */
export interface ReviewCommands {
  executeCorrelated(scope: CommandCorrelationScope, command: V2Command): Promise<CommandSettlement>;
}

/** @testOnly Defines the injectable attachment draft used by review regression fakes. */
export interface ReviewAttachmentDraft {
  attachText(name: string, mediaType: string, value: string): Promise<string>;
  commit(): void;
  prepareInput(text: string, target: ComposerAttachmentTarget): Promise<V2InputBlock[]>;
}

/** @testOnly Defines the injectable attachment owner used by review regression fakes. */
export interface ReviewAttachments {
  draft(scope: ComposerAttachmentDraftScope): ReviewAttachmentDraft;
}

interface ReviewCommandInput {
  commands: ReviewCommands;
  owner: QualifiedThread;
}

interface StartReviewInput extends ReviewCommandInput {
  delivery: ReviewDelivery;
  target: ReviewStartTarget;
}

interface SubmitReviewFeedbackInput extends ReviewCommandInput {
  attachments: ReviewAttachments;
  comments: ReviewComment[];
  draftId: string;
}

export interface StartReviewResult {
  reviewThreadId: string;
  turnId: string;
}

export async function startReview(input: StartReviewInput): Promise<StartReviewResult> {
  const settlement = await input.commands.executeCorrelated(
    {
      savedServerId: input.owner.savedServerId,
      surface: "threadComposer",
      threadId: input.owner.threadId,
    },
    {
      delivery: input.delivery,
      kind: "review.start",
      target: reviewTarget(input.target),
      threadId: input.owner.threadId,
    },
  );
  return reviewStartResult(settlement, input.owner.threadId);
}

export async function submitReviewFeedback(input: SubmitReviewFeedbackInput): Promise<void> {
  const feedback = serializeReviewFeedback(input.comments);
  if (feedback === "") throw new Error("Add at least one review comment");
  const target: ComposerAttachmentTarget = {
    threadId: input.owner.threadId,
    workspace: null,
  };
  const draft = input.attachments.draft({
    draftId: input.draftId,
    savedServerId: input.owner.savedServerId,
    target,
  });
  await draft.attachText("codewide-review-feedback.md", "text/markdown", feedback);
  const blocks = await draft.prepareInput("Review feedback is attached.", target);
  await executeTurn(input, turnCommand(input.owner, blocks));
  draft.commit();
}

/** @testOnly Exposes deterministic target normalization to focused review regressions. */
export function reviewTarget(target: ReviewStartTarget): V2ReviewTarget {
  switch (target.kind) {
    case "uncommitted":
      return { kind: "uncommittedChanges" };
    case "baseBranch": {
      const branch = requiredValue(target.branch, "Base branch");
      return { branch, kind: "baseBranch" };
    }
    case "commit": {
      const sha = requiredValue(target.sha, "Commit");
      return { kind: "commit", sha, title: null };
    }
    case "custom":
      return {
        instructions: requiredValue(target.instructions, "Review instructions"),
        kind: "custom",
      };
    default:
      return target;
  }
}

function turnCommand(owner: QualifiedThread, input: V2InputBlock[]): V2Command {
  return {
    input,
    intent: "chat",
    kind: "turn.submit",
    settings: null,
    threadId: owner.threadId,
    workspace: null,
  };
}

function reviewStartResult(settlement: CommandSettlement, threadId: string): StartReviewResult {
  if (settlement.kind !== "terminal") throw new Error(settlement.failure.message);
  const { frame } = settlement;
  if (frame.type !== "commandCompleted") throw new Error(frame.error.message);
  const { result } = frame;
  if (result.kind !== "review.start" || result.threadId !== threadId)
    throw new Error("The server returned an unexpected review result");
  return { reviewThreadId: result.reviewThreadId, turnId: result.turnId };
}

async function executeTurn(input: ReviewCommandInput, command: V2Command): Promise<void> {
  const settlement = await input.commands.executeCorrelated(
    {
      savedServerId: input.owner.savedServerId,
      surface: "threadComposer",
      threadId: input.owner.threadId,
    },
    command,
  );
  assertReviewSettlement(settlement, input.owner.threadId);
}

function assertReviewSettlement(settlement: CommandSettlement, threadId: string): void {
  if (settlement.kind !== "terminal") throw new Error(settlement.failure.message);
  assertReviewFrame(settlement.frame, threadId);
}

function assertReviewFrame(frame: V2CommandTerminalFrame, threadId: string): void {
  if (frame.type !== "commandCompleted") {
    throw new Error(frame.error.message);
  }
  const { result } = frame;
  if (result.kind !== "turn.submit" || result.threadId !== threadId) {
    throw new Error("The server returned an unexpected review result");
  }
}

function requiredValue(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed === "") throw new Error(`${label} is required`);
  return trimmed;
}
