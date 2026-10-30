import { describe, expect, it, vi } from "vitest";
import type { ScrollView, View } from "react-native";

import {
  parseConversationPage,
  type ConversationPage,
  type ReviewThreadId,
} from "../src/data/forgeConversationContract";
import {
  anchorLabel,
  eventRunLabel,
  firstLine,
} from "../src/features/pullRequestDetail/conversation/conversationContent";
import {
  projectDiscussion,
  reviewsSummary,
  threadSettled,
  type TimelineItem,
} from "../src/features/pullRequestDetail/conversation/discussionModel";
import { createDiscussionNavigator } from "../src/features/pullRequestDetail/conversation/discussionNavigator";
import {
  conversation91,
  conversationArcanum,
  conversationComment,
} from "./fixtures/forgeWireFixtures";

function parsed(value: unknown): ConversationPage {
  const page = parseConversationPage(value);
  if (page === null) {
    throw new Error("the conversation fixture must parse");
  }
  return page;
}

/** A compact, order-preserving description of the timeline. */
function shape(items: readonly TimelineItem[]): string[] {
  return items.map((item) => {
    if (item.kind === "comments") {
      return `comments:${item.comments.map((comment) => comment.id).join("+")}`;
    }
    if (item.kind === "events") {
      return `events:${item.events.map((event) => event.id).join("+")}`;
    }
    if (item.kind === "review") {
      return `review:${item.review.id}[${item.threads.map((thread) => thread.id).join(",")}]`;
    }
    if (item.kind === "verdict") {
      return `verdict:${item.review.id}`;
    }
    return `thread:${item.thread.id}`;
  });
}

const DANA = { avatarUrl: null, kind: "user", login: "dana" };
const OLEG = { avatarUrl: null, kind: "user", login: "oleg" };

function comment(id: string, author: typeof DANA, createdAt: string) {
  return { comment: conversationComment(id, { author, body: id, createdAt }), kind: "comment" };
}

function event(id: string, category: string, createdAt: string) {
  return { author: null, category, createdAt, id, kind: "event", text: id };
}

function page(entries: readonly unknown[]): ConversationPage {
  return parsed({ entries, nextCursor: null, openIssuesBlockMerge: null });
}

describe("discussion timeline", () => {
  it("keeps the newest-first page order, draws a review's threads inside its card and a review without text or threads as a row", () => {
    const discussion = projectDiscussion(parsed(conversation91));
    expect(shape(discussion.timeline)).toEqual([
      "events:e-1",
      "thread:rt-2",
      "review:r-1[rt-1]",
      "comments:c-1",
    ]);
    expect(discussion.commentCount).toBe(6);

    const arcanum = projectDiscussion(parsed(conversationArcanum));
    expect(shape(arcanum.timeline)).toEqual([
      "verdict:rv-approve",
      "thread:is-resolved",
      "comments:ac-2+ac-1",
      "thread:is-open-pr",
      "review:rv-block[is-open-line]",
      "thread:is-dropped",
      "events:ev-3+ev-2+ev-1",
    ]);
  });

  it("keeps a thread's own comments oldest first", () => {
    const [thread] = projectDiscussion(parsed(conversation91)).timeline.flatMap((item) =>
      item.kind === "review" ? item.threads : [],
    );
    expect(thread?.comments.map((entry) => entry.id)).toEqual(["c-2", "c-3", "c-4"]);
  });

  it("shows a thread on its own while its review is not loaded", () => {
    const thread = conversation91.entries[2];
    const discussion = projectDiscussion(page([thread]));
    expect(shape(discussion.timeline)).toEqual(["thread:rt-1"]);
  });

  it("draws a thread from an older page inside its review loaded on a newer page", () => {
    // The review is submitted after its inline thread starts, so newest first it arrives first.
    const [, , thread, review, older] = conversation91.entries;
    const discussion = projectDiscussion(page([review, thread, older]));
    expect(shape(discussion.timeline)).toEqual(["review:r-1[rt-1]", "comments:c-1"]);
  });

  it("groups nearby comments of one author, never across another author, a gap, an event or a thread", () => {
    const discussion = projectDiscussion(
      page([
        comment("h", DANA, "2026-10-21T09:26:00Z"),
        conversation91.entries[1],
        comment("g", DANA, "2026-10-21T09:24:00Z"),
        event("x", "state", "2026-10-21T09:23:00Z"),
        comment("f", DANA, "2026-10-21T09:22:00Z"),
        comment("e", OLEG, "2026-10-21T09:21:00Z"),
        comment("d", DANA, "2026-10-21T09:20:00Z"),
        comment("c", DANA, "2026-10-21T09:09:00Z"),
        comment("b", DANA, "2026-10-21T09:04:00Z"),
        comment("a", DANA, "2026-10-21T09:00:00Z"),
      ]),
    );
    expect(shape(discussion.timeline)).toEqual([
      "comments:h",
      "thread:rt-2",
      "comments:g",
      "events:x",
      "comments:f",
      "comments:e",
      "comments:d",
      "comments:c+b+a",
    ]);
  });

  it("does not group a comment that is newer than the one above it", () => {
    // Out-of-order input never joins a newest-first group.
    const discussion = projectDiscussion(
      page([
        comment("a", DANA, "2026-10-21T09:00:00Z"),
        comment("b", DANA, "2026-10-21T09:02:00Z"),
      ]),
    );
    expect(shape(discussion.timeline)).toEqual(["comments:a", "comments:b"]);
  });

  it("collapses runs of one event category only", () => {
    const discussion = projectDiscussion(
      page([
        event("p4", "push", "2026-10-21T09:05:00Z"),
        comment("a", DANA, "2026-10-21T09:04:00Z"),
        event("p3", "push", "2026-10-21T09:03:00Z"),
        event("s1", "state", "2026-10-21T09:02:00Z"),
        event("p2", "push", "2026-10-21T09:01:00Z"),
        event("p1", "push", "2026-10-21T09:00:00Z"),
      ]),
    );
    expect(shape(discussion.timeline)).toEqual([
      "events:p4",
      "comments:a",
      "events:p3",
      "events:s1",
      "events:p2+p1",
    ]);
    expect(eventRunLabel("push", 6)).toBe("6 updates pushed");
  });

  it("joins a run split across a page boundary when the older page loads", () => {
    const newer = [event("p3", "push", "2026-10-21T09:03:00Z")];
    const older = [
      event("p2", "push", "2026-10-21T09:01:00Z"),
      comment("a", DANA, "2026-10-21T09:00:00Z"),
    ];
    expect(shape(projectDiscussion(page(newer)).timeline)).toEqual(["events:p3"]);
    expect(shape(projectDiscussion(page([...newer, ...older])).timeline)).toEqual([
      "events:p3+p2",
      "comments:a",
    ]);
  });
});

describe("discussion issues and summary", () => {
  it("lists open issues first and settles resolved and dropped ones behind them, each newest first", () => {
    const discussion = projectDiscussion(parsed(conversationArcanum));
    expect(discussion.openIssues.map((issue) => issue.thread.id)).toEqual([
      "is-open-pr",
      "is-open-line",
    ]);
    expect(discussion.settledIssues.map((issue) => [issue.thread.id, issue.state])).toEqual([
      ["is-resolved", "resolved"],
      ["is-dropped", "dropped"],
    ]);
    expect(discussion.issueSummary).toEqual({ label: "2 open · blocks merge", tone: "danger" });
    expect(discussion.latestIteration).toBe(3);
  });

  it("has no Issues summary when the forge reports no issues", () => {
    expect(projectDiscussion(parsed(conversation91)).issueSummary).toBeNull();
  });

  it("does not claim a merge block the forge did not report", () => {
    const unknownRule = projectDiscussion(
      parsed({ ...conversationArcanum, openIssuesBlockMerge: null }),
    );
    expect(unknownRule.issueSummary).toEqual({ label: "2 open", tone: "warning" });
    const settled = projectDiscussion(
      parsed({
        ...conversationArcanum,
        entries: conversationArcanum.entries.filter(
          (entry) =>
            !("thread" in entry) ||
            !String((entry.thread as { id: string }).id).startsWith("is-open"),
        ),
      }),
    );
    expect(settled.issueSummary).toEqual({ label: "No open issues", tone: "success" });
  });

  it("starts settled threads collapsed", () => {
    const discussion = projectDiscussion(parsed(conversationArcanum));
    const settled = [...discussion.openIssues, ...discussion.settledIssues].map((issue) => [
      issue.thread.id,
      threadSettled(issue.thread),
    ]);
    expect(settled).toEqual([
      ["is-open-pr", false],
      ["is-open-line", false],
      ["is-resolved", true],
      ["is-dropped", true],
    ]);
  });
});

describe("reviewer verdicts", () => {
  function review(id: string, login: string, verdict: string, createdAt: string) {
    return {
      author: { avatarUrl: null, kind: "user", login },
      body: null,
      createdAt,
      id,
      kind: "review",
      verdict,
    };
  }

  it("keeps each reviewer's newest decisive verdict and lets a withdrawal clear an older approval", () => {
    const discussion = projectDiscussion(
      page([
        review("r-4", "bob", "approvalWithdrawn", "2026-10-21T12:00:00Z"),
        review("r-3", "alice", "commented", "2026-10-21T11:00:00Z"),
        review("r-2", "alice", "changesRequested", "2026-10-21T10:00:00Z"),
        review("r-1", "bob", "approved", "2026-10-21T09:00:00Z"),
        review("r-0", "carol", "approved", "2026-10-21T08:00:00Z"),
      ]),
    );
    expect(
      discussion.reviewers.map((reviewer) => [reviewer.author.login, reviewer.verdict]),
    ).toEqual([
      ["alice", "changesRequested"],
      ["carol", "approved"],
    ]);
    expect(reviewsSummary(discussion.reviewers)).toEqual({
      label: "alice requested changes · 1 approval",
      tone: "danger",
    });
  });

  it("summarizes approvals alone and says nothing without a standing verdict", () => {
    const one = projectDiscussion(page([review("r-1", "bob", "approved", "2026-10-21T09:00:00Z")]));
    expect(reviewsSummary(one.reviewers)).toEqual({ label: "Approved by bob", tone: "success" });
    const two = projectDiscussion(
      page([
        review("r-2", "carol", "approved", "2026-10-21T10:00:00Z"),
        review("r-1", "bob", "approved", "2026-10-21T09:00:00Z"),
      ]),
    );
    expect(reviewsSummary(two.reviewers)).toEqual({ label: "2 approvals", tone: "success" });
    expect(reviewsSummary(projectDiscussion(parsed(conversationArcanum)).reviewers)).toBeNull();
  });
});

describe("discussion labels", () => {
  it("labels every anchor kind", () => {
    expect(anchorLabel({ kind: "pullRequest" })).toBe("Pull request");
    expect(anchorLabel({ kind: "file", path: "a.rs" })).toBe("a.rs");
    expect(anchorLabel({ kind: "line", line: 9, path: "a.rs", side: "new", startLine: null })).toBe(
      "a.rs:9",
    );
    expect(anchorLabel({ kind: "line", line: 9, path: "a.rs", side: "old", startLine: 4 })).toBe(
      "a.rs:4-9",
    );
  });

  it("previews the first line of a body without its block markers", () => {
    expect(firstLine("## Race\n\nThe lock is released.")).toBe("Race");
    expect(firstLine("\n> - quoted item")).toBe("quoted item");
    expect(firstLine("```rust\nfn main() {}\n```")).toBe("fn main() {}");
  });
});

describe("discussion navigator", () => {
  // WHY: the brand marks a wire-validated id; this test owns the literal ids it registers.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const threadId = "rt-1" as ReviewThreadId;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const otherThreadId = "rt-2" as ReviewThreadId;

  function target(measured: { readonly y: number } | null) {
    const scrollTo = vi.fn();
    // WHY: the navigator calls only these two native methods; full host instances need a renderer.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const scroll = { scrollTo } as unknown as ScrollView;
    // WHY: as above, the content view is only the measurement reference.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const content = {} as View;
    const thread = {
      measureLayout: (_relative: unknown, success: (x: number, y: number) => void) => {
        if (measured !== null) {
          success(0, measured.y);
        }
      },
    };
    // WHY: as above, the thread view is only measured.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return { content, scroll, scrollTo, thread: thread as unknown as View };
  }

  it("expands a revealed thread and scrolls its top under the page inset", () => {
    const fake = target({ y: 640 });
    const navigator = createDiscussionNavigator({
      content: { current: fake.content },
      contentOffset: 16,
      scroll: { current: fake.scroll },
    });
    const detach = navigator.attach(threadId, fake.thread);
    expect(navigator.expanded(threadId)).toBeNull();

    navigator.reveal(threadId);

    expect(navigator.expanded(threadId)).toBe(true);
    expect(fake.scrollTo).toHaveBeenCalledWith({ animated: true, y: 640 });
    detach();
    navigator.reveal(threadId);
    expect(fake.scrollTo).toHaveBeenCalledTimes(1);
  });

  it("keeps the user's own choice per thread", () => {
    const navigator = createDiscussionNavigator({
      content: { current: null },
      contentOffset: 0,
      scroll: { current: null },
    });
    navigator.setExpanded(threadId, false);
    expect(navigator.expanded(threadId)).toBe(false);
    expect(navigator.expanded(otherThreadId)).toBeNull();
  });
});
