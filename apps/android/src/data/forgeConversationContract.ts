/**
 * Validated client view of a pull request's conversation
 * (`companion/pullRequest/conversation/read`) and of the two conversation
 * writes (`comment/create`, `reviewThread/reply`, `reviewThread/resolve`). Bodies are untrusted forge
 * Markdown: they reach only the safe renderer and are never logged.
 *
 * Comment and thread ids are both opaque provider strings; they are branded
 * apart so a comment id can never be sent where `reviewThread/reply` expects
 * a thread id.
 */
import {
  count,
  decodeOrNull,
  flag,
  ForgeWireError,
  list,
  nonEmptyText,
  oneOf,
  optionalText,
  record,
  text,
} from "./forgeWire";

declare const forgeCommentIdBrand: unique symbol;
declare const reviewThreadIdBrand: unique symbol;
declare const conversationReviewIdBrand: unique symbol;

/** Opaque provider id of one comment. */
type ForgeCommentId = string & { readonly [forgeCommentIdBrand]: true };
/** Opaque provider id of one review thread: the id `reviewThread/reply` and scenarios accept. */
export type ReviewThreadId = string & { readonly [reviewThreadIdBrand]: true };
/** Opaque provider id of one review entry; a thread's `reviewId` names it. */
type ConversationReviewId = string & { readonly [conversationReviewIdBrand]: true };

const AUTHOR_KINDS = ["user", "bot", "ai"] as const;
/** A person, an automation account, or an AI reviewer the forge identifies as one. */
type AuthorKind = (typeof AUTHOR_KINDS)[number];

/** Who wrote a comment, review or event. */
export type ConversationAuthor = {
  /** The plugin marked `avatarUrl` as public: the phone loads it directly. */
  readonly avatarDirect: boolean;
  readonly avatarUrl: string | null;
  readonly kind: AuthorKind;
  readonly login: string;
};

/**
 * A credential-free URL for one image a comment body references: a forge-signed,
 * short-lived URL or a public one. Images without an entry keep the companion path.
 */
type ConversationMedia = {
  /** Epoch milliseconds after which `url` no longer loads; `null` when it does not expire. */
  readonly expiresAtMs: number | null;
  /** The image URL exactly as written in the body: the stable cache identity. */
  readonly source: string;
  /** What the phone fetches, without any credential. */
  readonly url: string;
};

const REACTION_CONTENTS = [
  "thumbsUp",
  "thumbsDown",
  "laugh",
  "hooray",
  "confused",
  "heart",
  "rocket",
  "eyes",
] as const;
/** Forge-neutral reaction kind. */
export type ReactionContent = (typeof REACTION_CONTENTS)[number];

/** One reaction with at least one reactor. */
type ConversationReaction = {
  readonly content: ReactionContent;
  readonly count: number;
  readonly viewerReacted: boolean;
};

/** One comment: top-level, a review's own body or a thread reply. */
export type ConversationComment = {
  readonly author: ConversationAuthor;
  readonly body: string;
  readonly createdAt: string;
  readonly id: ForgeCommentId;
  /** Directly loadable URLs for images in `body`, keyed by their source URL. */
  readonly media: readonly ConversationMedia[];
  readonly reactions: readonly ConversationReaction[];
  /** `null` when the comment was never edited. */
  readonly updatedAt: string | null;
  readonly url: string | null;
};

const REVIEW_VERDICTS = [
  "approved",
  "changesRequested",
  "commented",
  "dismissed",
  "mergeBlocked",
  "mergeUnblocked",
  "approvalWithdrawn",
] as const;
/** A review's verdict; `commented` is a review without one. */
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

/** Where a review thread is anchored. */
export type ThreadAnchor =
  | { readonly kind: "pullRequest" }
  | { readonly kind: "file"; readonly path: string }
  | {
      readonly kind: "line";
      /** The last line, 1-based. */
      readonly line: number;
      readonly path: string;
      readonly side: "new" | "old";
      /** The first line of a range, strictly before `line`; `null` for one line. */
      readonly startLine: number | null;
    };

const ISSUE_STATES = ["open", "resolved", "dropped"] as const;
/** The lifecycle of an issue: a review remark that must be addressed. */
export type IssueState = (typeof ISSUE_STATES)[number];

/** Whether, and how, a review thread is settled. */
type ThreadResolution =
  | { readonly kind: "none" }
  | {
      readonly kind: "conversation";
      readonly resolved: boolean;
      /** The viewer may flip `resolved`: resolve while unresolved, unresolve while resolved. */
      readonly viewerCanToggle: boolean;
    }
  | {
      readonly changedAt: string | null;
      /** Who last changed the state, if the forge knows. */
      readonly changedBy: ConversationAuthor | null;
      readonly kind: "issue";
      readonly state: IssueState;
    };

/** The forge iteration (revision of the pull request) a thread was written on. */
type ConversationIteration = { readonly id: string; readonly number: number };

/** One line of a thread's code excerpt, numbered on the side(s) of the diff it belongs to. */
export type ExcerptLine =
  | {
      readonly kind: "context";
      readonly newLine: number;
      readonly oldLine: number;
      readonly text: string;
    }
  | { readonly kind: "added"; readonly newLine: number; readonly text: string }
  | { readonly kind: "removed"; readonly oldLine: number; readonly text: string };

/** The diff lines around a thread's anchor, top to bottom; the last line is the anchored one. */
export type CodeExcerpt = {
  readonly lines: readonly [ExcerptLine, ...ExcerptLine[]];
};

/** A review thread with its comments oldest first. */
export type ConversationReviewThread = {
  readonly anchor: ThreadAnchor;
  readonly comments: readonly [ConversationComment, ...ConversationComment[]];
  /** The code the thread is about, when the forge knows it. */
  readonly excerpt: CodeExcerpt | null;
  readonly id: ReviewThreadId;
  readonly iteration: ConversationIteration | null;
  /** The anchored code changed since the thread started. */
  readonly outdated: boolean;
  readonly resolution: ThreadResolution;
  /** The review entry this thread was published with; it may not be loaded yet. */
  readonly reviewId: ConversationReviewId | null;
  readonly viewerCanReply: boolean;
};

const EVENT_CATEGORIES = ["push", "state", "ci", "other"] as const;
/** What a timeline event is about. */
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

/** One commit of a push event. */
export type EventCommit = {
  readonly authorLogin: string | null;
  /** The full commit id. */
  readonly sha: string;
  /** The forge's abbreviated id, if it sends one. */
  readonly shortSha: string | null;
  /** The first line of the commit message. */
  readonly title: string;
};

/** The commits of one push: the first ones, oldest first, and how many the push had in all. */
export type EventCommits = {
  readonly items: readonly [EventCommit, ...EventCommit[]];
  /** At least `items.length`. */
  readonly total: number;
};

/** One conversation entry, ordered by its own creation time. */
export type ConversationEntry =
  | { readonly comment: ConversationComment; readonly kind: "comment" }
  | {
      readonly author: ConversationAuthor;
      /** The review's own summary body, if any; inline comments live in their threads. */
      readonly body: ConversationComment | null;
      readonly createdAt: string;
      readonly id: ConversationReviewId;
      readonly kind: "review";
      readonly verdict: ReviewVerdict;
    }
  | { readonly kind: "reviewThread"; readonly thread: ConversationReviewThread }
  | {
      readonly author: ConversationAuthor | null;
      readonly category: EventCategory;
      /** The commits of a push event; `null` for every other event. */
      readonly commits: EventCommits | null;
      readonly createdAt: string;
      readonly id: string;
      readonly kind: "event";
      readonly text: string;
    };

/** One page of the conversation, newest first; `nextCursor` continues to older entries. */
export type ConversationPage = {
  readonly entries: readonly ConversationEntry[];
  readonly nextCursor: string | null;
  /** Whether an open issue prevents merging; `null` when the forge has no such rule. */
  readonly openIssuesBlockMerge: boolean | null;
};

function forgeCommentId(value: unknown, path: string): ForgeCommentId {
  // WHY: the brand records that the value passed the non-empty wire check above; no runtime shape changes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return nonEmptyText(value, path) as ForgeCommentId;
}

function reviewThreadId(value: unknown, path: string): ReviewThreadId {
  // WHY: the brand records that the value passed the non-empty wire check above; no runtime shape changes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return nonEmptyText(value, path) as ReviewThreadId;
}

function conversationReviewId(value: unknown, path: string): ConversationReviewId {
  // WHY: the brand records that the value passed the non-empty wire check above; no runtime shape changes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return nonEmptyText(value, path) as ConversationReviewId;
}

function author(value: unknown, path: string): ConversationAuthor {
  const entry = record(value, path);
  return {
    avatarDirect:
      entry.avatarDirect === undefined ? false : flag(entry.avatarDirect, `${path}.avatarDirect`),
    avatarUrl: optionalText(entry.avatarUrl, `${path}.avatarUrl`),
    kind: oneOf(entry.kind, AUTHOR_KINDS, `${path}.kind`),
    login: nonEmptyText(entry.login, `${path}.login`),
  };
}

/** A positive integer: a line number or an iteration number. */
function positive(value: unknown, path: string): number {
  const result = count(value, path);
  if (result === 0) {
    throw new ForgeWireError(path);
  }
  return result;
}

function anchor(value: unknown, path: string): ThreadAnchor {
  const entry = record(value, path);
  const kind = oneOf(entry.kind, ["pullRequest", "file", "line"], `${path}.kind`);
  if (kind === "pullRequest") {
    return { kind };
  }
  const file = nonEmptyText(entry.path, `${path}.path`);
  if (kind === "file") {
    return { kind, path: file };
  }
  const line = positive(entry.line, `${path}.line`);
  const startLine =
    entry.startLine === null ? null : positive(entry.startLine, `${path}.startLine`);
  if (startLine !== null && startLine >= line) {
    throw new ForgeWireError(`${path}.startLine`);
  }
  return {
    kind,
    line,
    path: file,
    side: oneOf(entry.side, ["new", "old"], `${path}.side`),
    startLine,
  };
}

function resolution(value: unknown, path: string): ThreadResolution {
  const entry = record(value, path);
  const kind = oneOf(entry.kind, ["none", "conversation", "issue"], `${path}.kind`);
  if (kind === "none") {
    return { kind };
  }
  if (kind === "conversation") {
    return {
      kind,
      resolved: flag(entry.resolved, `${path}.resolved`),
      viewerCanToggle:
        entry.viewerCanToggle === undefined
          ? false
          : flag(entry.viewerCanToggle, `${path}.viewerCanToggle`),
    };
  }
  return {
    changedAt: optionalText(entry.changedAt, `${path}.changedAt`),
    changedBy: entry.changedBy === null ? null : author(entry.changedBy, `${path}.changedBy`),
    kind,
    state: oneOf(entry.state, ISSUE_STATES, `${path}.state`),
  };
}

function iteration(value: unknown, path: string): ConversationIteration | null {
  if (value === null) {
    return null;
  }
  const entry = record(value, path);
  return {
    id: nonEmptyText(entry.id, `${path}.id`),
    number: positive(entry.number, `${path}.number`),
  };
}

/** Decodes reactions; a reaction nobody holds any more (count 0) is not shown. */
function reactions(value: unknown, path: string): ConversationReaction[] {
  return list(value, path, (item, itemPath): ConversationReaction => {
    const entry = record(item, itemPath);
    return {
      content: oneOf(entry.content, REACTION_CONTENTS, `${itemPath}.content`),
      count: count(entry.count, `${itemPath}.count`),
      viewerReacted: flag(entry.viewerReacted, `${itemPath}.viewerReacted`),
    };
  }).filter((reaction) => reaction.count > 0);
}

/**
 * Decodes the optional `media` list. A malformed entry rejects the page like any
 * other field; an entry that is well-formed but unusable here (not `https`, an
 * unreadable expiry) is dropped, so its image keeps the companion path.
 */
function media(value: unknown, path: string): ConversationMedia[] {
  if (value === undefined) {
    return [];
  }
  return list(value, path, (item, itemPath): ConversationMedia | null => {
    const entry = record(item, itemPath);
    const source = nonEmptyText(entry.source, `${itemPath}.source`);
    const url = nonEmptyText(entry.url, `${itemPath}.url`);
    const expiresAt = optionalText(entry.expiresAt, `${itemPath}.expiresAt`);
    const expiresAtMs = expiresAt === null ? null : Date.parse(expiresAt);
    if (!url.startsWith("https://") || Number.isNaN(expiresAtMs)) {
      return null;
    }
    return { expiresAtMs, source, url };
  }).filter((entry) => entry !== null);
}

function comment(value: unknown, path: string): ConversationComment {
  const entry = record(value, path);
  return {
    author: author(entry.author, `${path}.author`),
    body: text(entry.body, `${path}.body`),
    createdAt: nonEmptyText(entry.createdAt, `${path}.createdAt`),
    id: forgeCommentId(entry.id, `${path}.id`),
    media: media(entry.media, `${path}.media`),
    reactions: reactions(entry.reactions, `${path}.reactions`),
    updatedAt: optionalText(entry.updatedAt, `${path}.updatedAt`),
    url: optionalText(entry.url, `${path}.url`),
  };
}

function threadComments(
  value: unknown,
  path: string,
): readonly [ConversationComment, ...ConversationComment[]] {
  const [first, ...rest] = list(value, path, comment);
  if (first === undefined) {
    throw new ForgeWireError(path);
  }
  return [first, ...rest];
}

/** The most lines an excerpt carries. */
const MAX_EXCERPT_LINES = 8;

function excerptLine(value: unknown, path: string): ExcerptLine {
  const entry = record(value, path);
  const kind = oneOf(entry.kind, ["context", "added", "removed"], `${path}.kind`);
  const lineText = text(entry.text, `${path}.text`);
  if (lineText.includes("\n") || lineText.includes("\r")) {
    throw new ForgeWireError(`${path}.text`);
  }
  if (kind === "added") {
    return { kind, newLine: positive(entry.newLine, `${path}.newLine`), text: lineText };
  }
  if (kind === "removed") {
    return { kind, oldLine: positive(entry.oldLine, `${path}.oldLine`), text: lineText };
  }
  return {
    kind,
    newLine: positive(entry.newLine, `${path}.newLine`),
    oldLine: positive(entry.oldLine, `${path}.oldLine`),
    text: lineText,
  };
}

/** Decodes the optional excerpt: absent or `null` is none; 1 to 8 lines otherwise. */
function excerpt(value: unknown, path: string): CodeExcerpt | null {
  if (value === undefined || value === null) {
    return null;
  }
  const entry = record(value, path);
  const [first, ...rest] = list(entry.lines, `${path}.lines`, excerptLine);
  if (first === undefined || rest.length + 1 > MAX_EXCERPT_LINES) {
    throw new ForgeWireError(`${path}.lines`);
  }
  return { lines: [first, ...rest] };
}

function reviewThread(value: unknown, path: string): ConversationReviewThread {
  const entry = record(value, path);
  return {
    anchor: anchor(entry.anchor, `${path}.anchor`),
    comments: threadComments(entry.comments, `${path}.comments`),
    excerpt: excerpt(entry.excerpt, `${path}.excerpt`),
    id: reviewThreadId(entry.id, `${path}.id`),
    iteration: iteration(entry.iteration, `${path}.iteration`),
    outdated: flag(entry.outdated, `${path}.outdated`),
    resolution: resolution(entry.resolution, `${path}.resolution`),
    reviewId:
      entry.reviewId === null ? null : conversationReviewId(entry.reviewId, `${path}.reviewId`),
    viewerCanReply: flag(entry.viewerCanReply, `${path}.viewerCanReply`),
  };
}

function review(entry: Record<string, unknown>, path: string): ConversationEntry {
  return {
    author: author(entry.author, `${path}.author`),
    body: entry.body === null ? null : comment(entry.body, `${path}.body`),
    createdAt: nonEmptyText(entry.createdAt, `${path}.createdAt`),
    id: conversationReviewId(entry.id, `${path}.id`),
    kind: "review",
    verdict: oneOf(entry.verdict, REVIEW_VERDICTS, `${path}.verdict`),
  };
}

/** The most commits one push event lists. */
const MAX_EVENT_COMMITS = 20;

function optionalField(value: unknown, path: string): string | null {
  return value === undefined ? null : optionalText(value, path);
}

function eventCommit(value: unknown, path: string): EventCommit {
  const entry = record(value, path);
  return {
    authorLogin: optionalField(entry.authorLogin, `${path}.authorLogin`),
    sha: nonEmptyText(entry.sha, `${path}.sha`),
    shortSha: optionalField(entry.shortSha, `${path}.shortSha`),
    title: text(entry.title, `${path}.title`),
  };
}

/** Decodes a push's commits: absent or `null` is none; 1 to 20 items and a total at least as large. */
function eventCommits(value: unknown, path: string): EventCommits | null {
  if (value === undefined || value === null) {
    return null;
  }
  const entry = record(value, path);
  const [first, ...rest] = list(entry.items, `${path}.items`, eventCommit);
  const total = count(entry.total, `${path}.total`);
  if (first === undefined || rest.length + 1 > MAX_EVENT_COMMITS || total < rest.length + 1) {
    throw new ForgeWireError(`${path}.items`);
  }
  return { items: [first, ...rest], total };
}

function timelineEvent(entry: Record<string, unknown>, path: string): ConversationEntry {
  return {
    author: entry.author === null ? null : author(entry.author, `${path}.author`),
    category: oneOf(entry.category, EVENT_CATEGORIES, `${path}.category`),
    commits: eventCommits(entry.commits, `${path}.commits`),
    createdAt: nonEmptyText(entry.createdAt, `${path}.createdAt`),
    id: nonEmptyText(entry.id, `${path}.id`),
    kind: "event",
    text: text(entry.text, `${path}.text`),
  };
}

function conversationEntry(value: unknown, path: string): ConversationEntry {
  const entry = record(value, path);
  const kind = oneOf(entry.kind, ["comment", "review", "reviewThread", "event"], `${path}.kind`);
  if (kind === "comment") {
    return { comment: comment(entry.comment, `${path}.comment`), kind };
  }
  if (kind === "review") {
    return review(entry, path);
  }
  if (kind === "reviewThread") {
    return { kind, thread: reviewThread(entry.thread, `${path}.thread`) };
  }
  return timelineEvent(entry, path);
}

/** Parses `companion/pullRequest/conversation/read`; any malformed entry rejects the page. */
export function parseConversationPage(value: unknown): ConversationPage | null {
  return decodeOrNull(() => {
    const page = record(value, "result");
    return {
      entries: list(page.entries, "entries", conversationEntry),
      nextCursor: optionalText(page.nextCursor, "nextCursor"),
      openIssuesBlockMerge:
        page.openIssuesBlockMerge === null
          ? null
          : flag(page.openIssuesBlockMerge, "openIssuesBlockMerge"),
    };
  });
}

/** Parses the acknowledged `{ comment }` of `comment/create` and `reviewThread/reply`. */
export function parseConversationWrite(value: unknown): ConversationComment | null {
  return decodeOrNull(() => comment(record(value, "result").comment, "comment"));
}

/** A thread's conversation resolution after `reviewThread/resolve`. */
export type ThreadResolveResult = {
  readonly resolved: boolean;
  readonly viewerCanToggle: boolean;
};

/** Parses the acknowledged `{ resolved, viewerCanToggle }` of `reviewThread/resolve`. */
export function parseThreadResolveWrite(value: unknown): ThreadResolveResult | null {
  return decodeOrNull(() => {
    const result = record(value, "result");
    return {
      resolved: flag(result.resolved, "resolved"),
      viewerCanToggle: flag(result.viewerCanToggle, "viewerCanToggle"),
    };
  });
}
