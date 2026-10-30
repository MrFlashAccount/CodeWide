/**
 * Projects loaded conversation pages into the Discussion section: the pinned
 * issues, the summary chip and a newest-first timeline in which reviews
 * contain their threads, nearby comments of one author are grouped and runs of
 * same-category events collapse. Pages arrive newest first and later pages
 * hold older entries, so the concatenated entries are already in display
 * order; only a thread's own comments read oldest first. Pure and forge-independent: it reads only the
 * declared contract fields, never a forge's name.
 */
import type {
  ConversationAuthor,
  ConversationComment,
  ConversationEntry,
  ConversationPage,
  ConversationReviewThread,
  EventCategory,
  IssueState,
} from "../../../data/forgeConversationContract";

/** Consecutive comments of one author at most five minutes apart share one group. */
const COMMENT_GROUP_WINDOW_MS = 300_000;

/** A review entry of the page. */
export type ReviewEntry = Extract<ConversationEntry, { readonly kind: "review" }>;
/** A timeline event of the page. */
export type EventEntry = Extract<ConversationEntry, { readonly kind: "event" }>;

/** One issue thread of the pinned list. */
export type DiscussionIssue = {
  readonly state: IssueState;
  readonly thread: ConversationReviewThread;
};

/** One rendered timeline item, newest first. */
export type TimelineItem =
  /** A review with a body or threads: a card containing its threads, newest first. */
  | {
      readonly key: string;
      readonly kind: "review";
      readonly review: ReviewEntry;
      readonly threads: readonly ConversationReviewThread[];
    }
  /** A verdict without text or threads: a compact row. */
  | {
      readonly key: string;
      readonly kind: "verdict";
      readonly review: ReviewEntry;
    }
  /** A thread without a loaded review. */
  | {
      readonly key: string;
      readonly kind: "thread";
      readonly thread: ConversationReviewThread;
    }
  /** Top-level comments of one author, newest first, each within the window of the one above. */
  | {
      readonly author: ConversationAuthor;
      readonly comments: readonly [ConversationComment, ...ConversationComment[]];
      readonly key: string;
      readonly kind: "comments";
    }
  /** Consecutive events of one category, newest first; a run of one is a single event row. */
  | {
      readonly category: EventCategory;
      readonly events: readonly [EventEntry, ...EventEntry[]];
      readonly key: string;
      readonly kind: "events";
    };

/** The summary chip beside the Discussion heading. */
type DiscussionSummary = {
  readonly label: string;
  readonly tone: "danger" | "success" | "warning";
};

/** Everything the Discussion section renders from the loaded pages. */
export type Discussion = {
  /** Comments loaded so far: top-level, review bodies and thread comments. */
  readonly commentCount: number;
  /** The largest iteration number seen on a thread; `null` without iterations. */
  readonly latestIteration: number | null;
  /** Open issues, newest first. */
  readonly openIssues: readonly DiscussionIssue[];
  /** Resolved and dropped issues, newest first; shown behind a counter. */
  readonly settledIssues: readonly DiscussionIssue[];
  readonly summary: DiscussionSummary | null;
  readonly timeline: readonly TimelineItem[];
};

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

function issueOf(thread: ConversationReviewThread): DiscussionIssue | null {
  return thread.resolution.kind === "issue" ? { state: thread.resolution.state, thread } : null;
}

/** The chip: open issues (and whether they block merging) when the forge has issues, otherwise unresolved threads. */
function summaryOf(
  threads: readonly ConversationReviewThread[],
  issues: {
    readonly blocksMerge: boolean | null;
    readonly open: number;
    readonly total: number;
  },
): DiscussionSummary | null {
  if (issues.total > 0) {
    if (issues.open === 0) {
      return { label: "No open issues", tone: "success" };
    }
    const label = plural(issues.open, "open issue", "open issues");
    return issues.blocksMerge === true
      ? { label: `${label} · blocks merge`, tone: "danger" }
      : { label, tone: "warning" };
  }
  const unresolved = threads.filter(
    (thread) => thread.resolution.kind === "conversation" && !thread.resolution.resolved,
  ).length;
  return unresolved === 0 ? null : { label: `${String(unresolved)} unresolved`, tone: "warning" };
}

/** Whether `older`, the next comment down the newest-first timeline, joins the group of `newer`. */
function withinWindow(newer: ConversationComment, older: ConversationComment): boolean {
  const gap = Date.parse(newer.createdAt) - Date.parse(older.createdAt);
  return Number.isFinite(gap) && gap >= 0 && gap <= COMMENT_GROUP_WINDOW_MS;
}

/**
 * Builds the timeline in one pass. The open comment group and event run are
 * the same arrays their timeline items hold, so continuing one appends in
 * place; any other item closes both, so groups never span verdicts, threads
 * or events.
 */
class TimelineBuilder {
  readonly items: TimelineItem[] = [];
  private group: ConversationComment[] | null = null;
  private run: EventEntry[] | null = null;

  private readonly threadsByReview: ReadonlyMap<string, readonly ConversationReviewThread[]>;

  constructor(threadsByReview: ReadonlyMap<string, readonly ConversationReviewThread[]>) {
    this.threadsByReview = threadsByReview;
  }

  add(entry: ConversationEntry): void {
    if (entry.kind === "comment") {
      this.comment(entry.comment);
    } else if (entry.kind === "event") {
      this.event(entry);
    } else if (entry.kind === "review") {
      this.review(entry);
    } else if (entry.thread.reviewId === null || !this.threadsByReview.has(entry.thread.reviewId)) {
      // A thread whose review is loaded is drawn inside that review's card.
      this.push({
        key: `thread:${entry.thread.id}`,
        kind: "thread",
        thread: entry.thread,
      });
    }
  }

  private push(item: TimelineItem): void {
    this.group = null;
    this.run = null;
    this.items.push(item);
  }

  private comment(comment: ConversationComment): void {
    const previous = this.group?.at(-1);
    if (
      this.group !== null &&
      previous !== undefined &&
      previous.author.login === comment.author.login &&
      withinWindow(previous, comment)
    ) {
      this.group.push(comment);
      return;
    }
    const comments: [ConversationComment, ...ConversationComment[]] = [comment];
    this.push({
      author: comment.author,
      comments,
      key: `comment:${comment.id}`,
      kind: "comments",
    });
    this.group = comments;
  }

  private event(event: EventEntry): void {
    if (this.run !== null && this.run[0]?.category === event.category) {
      this.run.push(event);
      return;
    }
    const events: [EventEntry, ...EventEntry[]] = [event];
    this.push({
      category: event.category,
      events,
      key: `event:${event.id}`,
      kind: "events",
    });
    this.run = events;
  }

  private review(review: ReviewEntry): void {
    const threads = this.threadsByReview.get(review.id) ?? [];
    this.push(
      review.body === null && threads.length === 0
        ? { key: `review:${review.id}`, kind: "verdict", review }
        : { key: `review:${review.id}`, kind: "review", review, threads },
    );
  }
}

function commentsIn(entry: ConversationEntry): number {
  if (entry.kind === "comment") {
    return 1;
  }
  if (entry.kind === "review") {
    return entry.body === null ? 0 : 1;
  }
  return entry.kind === "reviewThread" ? entry.thread.comments.length : 0;
}

/** Threads by the id of the loaded review they were published with; every loaded review has a list. */
function threadsByReviewOf(
  entries: readonly ConversationEntry[],
  threads: readonly ConversationReviewThread[],
): Map<string, ConversationReviewThread[]> {
  const byReview = new Map<string, ConversationReviewThread[]>();
  for (const entry of entries) {
    if (entry.kind === "review") {
      byReview.set(entry.id, []);
    }
  }
  for (const thread of threads) {
    if (thread.reviewId !== null) {
      byReview.get(thread.reviewId)?.push(thread);
    }
  }
  return byReview;
}

function latestIterationOf(threads: readonly ConversationReviewThread[]): number | null {
  let latest: number | null = null;
  for (const { iteration } of threads) {
    if (iteration !== null) {
      latest = Math.max(latest ?? 0, iteration.number);
    }
  }
  return latest;
}

/** Projects the loaded pages; entries keep the forge's newest-first order. */
export function projectDiscussion(page: ConversationPage): Discussion {
  const threads = page.entries.flatMap((entry) =>
    entry.kind === "reviewThread" ? [entry.thread] : [],
  );
  const builder = new TimelineBuilder(threadsByReviewOf(page.entries, threads));
  let commentCount = 0;
  for (const entry of page.entries) {
    builder.add(entry);
    commentCount += commentsIn(entry);
  }
  const issues = threads.map(issueOf).filter((issue) => issue !== null);
  const openIssues = issues.filter((issue) => issue.state === "open");
  return {
    commentCount,
    latestIteration: latestIterationOf(threads),
    openIssues,
    settledIssues: issues.filter((issue) => issue.state !== "open"),
    summary: summaryOf(threads, {
      blocksMerge: page.openIssuesBlockMerge,
      open: openIssues.length,
      total: issues.length,
    }),
    timeline: builder.items,
  };
}

/** Whether a thread starts collapsed: it is settled, so its remarks need no attention. */
export function threadSettled(thread: ConversationReviewThread): boolean {
  const { resolution } = thread;
  if (resolution.kind === "conversation") {
    return resolution.resolved;
  }
  return resolution.kind === "issue" && resolution.state !== "open";
}
