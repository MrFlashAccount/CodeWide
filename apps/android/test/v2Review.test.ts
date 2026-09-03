import type {
  V2Command,
  V2CommandResult,
  V2InputBlock,
  V2Query,
  V2QueryResult,
} from "@codewide/sync-client/v2";
import { describe, expect, it } from "vitest";

import type {
  CommandCorrelationScope,
  CommandSettlement,
} from "../src/v2/application/commandCorrelation";
import type { ComposerAttachmentDraftScope } from "../src/v2/application/composer/composerAttachmentController";
import type { ComposerAttachmentTarget } from "../src/v2/application/ports/composerAttachmentTransport";
import { savedServerId, threadId } from "../src/v2/domain/ids";
import { qualifiedThread } from "../src/v2/domain/qualifiedThread";
import { reviewRoute } from "../src/v2/features/review/reviewRoute";
import {
  type ReviewAttachmentDraft,
  type ReviewAttachments,
  type ReviewCommands,
  reviewTarget,
  startReview,
  submitReviewFeedback,
} from "../src/v2/features/review/reviewSubmission";
import {
  ResponseReviewResource,
  type ResponseReviewQueries,
} from "../src/v2/features/review/responseReviewResource";
import { reviewDiffLines, reviewSplitLines } from "../src/v2/rendering/review/reviewDiffModel";
import { reviewResponseTarget } from "../src/v2/rendering/review/reviewModel";
import { serializeReviewFeedback } from "../src/v2/rendering/review/reviewSerialization";

const REVIEW_LINE = 12;
const DIFF_LINE = 3;
const ADDED_LINE_INDEX = 2;

describe("V2 code review", () => {
  it("parses only complete typed review routes", () => {
    expect(
      reviewRoute({
        itemId: "item-1",
        mode: "response",
        savedServerId: "server-1",
        threadId: "thread-1",
        turnId: "turn-1",
      }),
    ).toMatchObject({ itemId: "item-1", mode: "response", turnId: "turn-1" });
    expect(
      reviewRoute({ mode: "response", savedServerId: "server-1", threadId: "thread-1" }),
    ).toBeNull();
    expect(
      reviewRoute({
        mode: "changes",
        savedServerId: "server-1",
        scope: "wat",
        threadId: "thread-1",
      }),
    ).toBeNull();
    expect(
      reviewRoute({
        itemId: "unexpected",
        mode: "changes",
        savedServerId: "server-1",
        threadId: "thread-1",
      }),
    ).toBeNull();
  });

  it("maps review targets to the dedicated V2 review command shape", () => {
    expect(reviewTarget({ kind: "uncommitted" })).toStrictEqual({ kind: "uncommittedChanges" });
    expect(reviewTarget({ branch: "main", kind: "baseBranch" })).toStrictEqual({
      branch: "main",
      kind: "baseBranch",
    });
    expect(reviewTarget({ kind: "commit", sha: "abc123" })).toStrictEqual({
      kind: "commit",
      sha: "abc123",
      title: null,
    });
  });

  it("starts review through the dedicated authoritative command", async () => {
    const owner = qualifiedThread(savedServerId("server-1"), threadId("thread-1"));
    const commands = new FakeReviewCommands({
      kind: "review.start",
      reviewThreadId: "review-thread-1",
      threadId: owner.threadId,
      turnId: "turn-1",
    });
    await expect(
      startReview({
        commands,
        delivery: "detached",
        owner,
        target: { branch: "main", kind: "baseBranch" },
      }),
    ).resolves.toStrictEqual({ reviewThreadId: "review-thread-1", turnId: "turn-1" });
    expect(commands.calls).toStrictEqual([
      {
        command: {
          delivery: "detached",
          kind: "review.start",
          target: { branch: "main", kind: "baseBranch" },
          threadId: owner.threadId,
        },
        scope: {
          savedServerId: owner.savedServerId,
          surface: "threadComposer",
          threadId: owner.threadId,
        },
      },
    ]);
  });

  it("submits review feedback as a staged markdown attachment", async () => {
    const owner = qualifiedThread(savedServerId("server-1"), threadId("thread-1"));
    const commands = new FakeReviewCommands({
      kind: "turn.submit",
      threadId: owner.threadId,
      turnId: "turn-2",
    });
    const attachments = new FakeReviewAttachments();
    await submitReviewFeedback({
      attachments,
      commands,
      comments: [
        {
          anchor: {
            context: "const value = oldValue;",
            kind: "line",
            line: REVIEW_LINE,
            path: "src/value.ts",
            side: "new",
            target: { id: "file", label: "src/value.ts", reference: "src/value.ts" },
          },
          body: "Use the validated value.",
          id: "comment-1",
          order: 1,
        },
      ],
      draftId: "review-attempt-1",
      owner,
    });
    expect(attachments.scope).toStrictEqual({
      draftId: "review-attempt-1",
      savedServerId: owner.savedServerId,
      target: { threadId: owner.threadId, workspace: null },
    });
    expect(attachments.draftInstance.attachment).toMatchObject({
      mediaType: "text/markdown",
      name: "codewide-review-feedback.md",
    });
    expect(attachments.draftInstance.attachment?.value).toContain("Use the validated value.");
    expect(attachments.draftInstance.committed).toBe(true);
    expect(commands.calls[0]?.command).toMatchObject({
      input: [
        { kind: "text", text: "Review feedback is attached." },
        { attachmentId: "review-feedback-attachment", kind: "attachment" },
      ],
      intent: "chat",
      kind: "turn.submit",
      threadId: owner.threadId,
    });
  });

  it("does not commit staged review feedback when the authoritative command fails", async () => {
    const owner = qualifiedThread(savedServerId("server-1"), threadId("thread-1"));
    const attachments = new FakeReviewAttachments();
    await expect(
      submitReviewFeedback({
        attachments,
        commands: new RejectedReviewCommands(),
        comments: [
          {
            anchor: {
              kind: "response",
              target: reviewResponseTarget("turn-1", "item-1"),
            },
            body: "Keep the failure recoverable.",
            id: "comment-1",
            order: 1,
          },
        ],
        draftId: "review-attempt-1",
        owner,
      }),
    ).rejects.toThrow("Review submission was rejected");
    expect(attachments.draftInstance.committed).toBe(false);
  });

  it("builds anchored unified and split review lines", () => {
    const lines = reviewDiffLines("src/value.ts", [
      {
        diff: "@@ -3,2 +3,2 @@\n-old\n+new\n same",
        itemId: "item-1",
        kind: "update",
        turnId: "turn-1",
      },
    ]);
    expect(lines[1]?.anchor).toMatchObject({ line: DIFF_LINE, path: "src/value.ts", side: "old" });
    expect(lines[ADDED_LINE_INDEX]?.anchor).toMatchObject({
      line: DIFF_LINE,
      path: "src/value.ts",
      side: "new",
    });
    expect(reviewSplitLines(lines)[1]).toMatchObject({
      left: { text: "old" },
      right: { text: "new" },
    });
  });

  it("serializes response feedback without copying the response body", () => {
    const target = reviewResponseTarget("turn-1", "item-1");
    const result = serializeReviewFeedback([
      {
        anchor: { kind: "response", target },
        body: "Tighten this conclusion.",
        id: "c1",
        order: 1,
      },
    ]);
    expect(result).toContain("codewide-review-feedback");
    expect(result).toContain("turn-1:item-1");
    expect(result).toContain("Tighten this conclusion.");
    expect(result).not.toContain("agent response body");
  });

  it("follows authoritative turn-item cursors until the selected response is found", async () => {
    const queries = new PagedResponseQueries();
    const resource = new ResponseReviewResource({
      itemId: "answer",
      queries,
      savedServerId: savedServerId("server-1"),
      threadId: "thread-1",
      turnId: "turn-1",
    });
    await resource.refresh();
    expect(queries.cursors).toStrictEqual([null, "page-2"]);
    expect(resource.snapshot()).toStrictEqual({ status: "ready", value: "Authoritative answer" });
  });
});

class PagedResponseQueries implements ResponseReviewQueries {
  readonly cursors: Array<string | null> = [];

  async execute(_server: ReturnType<typeof savedServerId>, query: V2Query): Promise<V2QueryResult> {
    await Promise.resolve();
    if (query.kind !== "turn.items") {
      throw new Error("unexpected query");
    }
    this.cursors.push(query.cursor);
    return query.cursor === null
      ? {
          items: [],
          kind: "turn.items",
          next: "page-2",
          threadId: query.threadId,
          turnId: query.turnId,
        }
      : {
          items: [{ id: "answer", kind: "assistantText", text: "Authoritative answer" }],
          kind: "turn.items",
          next: null,
          threadId: query.threadId,
          turnId: query.turnId,
        };
  }
}

interface ReviewCommandCall {
  command: V2Command;
  scope: CommandCorrelationScope;
}

class FakeReviewCommands implements ReviewCommands {
  readonly calls: ReviewCommandCall[] = [];
  readonly #result: V2CommandResult;

  constructor(result: V2CommandResult) {
    this.#result = result;
  }

  async executeCorrelated(
    scope: CommandCorrelationScope,
    command: V2Command,
  ): Promise<CommandSettlement> {
    await Promise.resolve();
    this.calls.push({ command, scope });
    return {
      correlationId: "correlation-1",
      frame: { operationId: "operation-1", result: this.#result, type: "commandCompleted" },
      kind: "terminal",
      operationId: "operation-1",
    };
  }
}

class RejectedReviewCommands implements ReviewCommands {
  async executeCorrelated(): Promise<CommandSettlement> {
    await Promise.resolve();
    return {
      correlationId: "correlation-1",
      failure: {
        code: "rejected",
        message: "Review submission was rejected",
        retryable: true,
      },
      kind: "notCreated",
      operationId: "operation-1",
    };
  }
}

interface AttachedText {
  mediaType: string;
  name: string;
  value: string;
}

class FakeReviewAttachmentDraft implements ReviewAttachmentDraft {
  attachment: AttachedText | null = null;
  committed = false;

  async attachText(name: string, mediaType: string, value: string): Promise<string> {
    await Promise.resolve();
    this.attachment = { mediaType, name, value };
    return "local-review-feedback";
  }

  commit(): void {
    this.committed = true;
  }

  async prepareInput(text: string, _target: ComposerAttachmentTarget): Promise<V2InputBlock[]> {
    await Promise.resolve();
    return [
      { kind: "text", text },
      { attachmentId: "review-feedback-attachment", kind: "attachment" },
    ];
  }
}

class FakeReviewAttachments implements ReviewAttachments {
  readonly draftInstance = new FakeReviewAttachmentDraft();
  scope: ComposerAttachmentDraftScope | null = null;

  draft(scope: ComposerAttachmentDraftScope): ReviewAttachmentDraft {
    this.scope = scope;
    return this.draftInstance;
  }
}
