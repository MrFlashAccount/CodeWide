/**
 * Maps the forge conversation DTOs into the forge-independent message model.
 * The forge reaction vocabulary becomes emoji here, so `features/messageContent`
 * never learns a forge's names.
 */
import type {
  ConversationAuthor,
  ConversationComment,
  EventCategory,
  ReactionContent,
  ReviewVerdict,
  ThreadAnchor,
} from "../../../data/forgeConversationContract";
import type {
  MessageAuthor,
  MessageContent,
  MessageReaction,
} from "../../messageContent/messageContent";

const REACTION_EMOJI: Readonly<Record<ReactionContent, string>> = {
  confused: "😕",
  eyes: "👀",
  heart: "❤️",
  hooray: "🎉",
  laugh: "😄",
  rocket: "🚀",
  thumbsDown: "👎",
  thumbsUp: "👍",
};

/** The tinted circle of a one-line timeline row; color always pairs with the row's words. */
export type EventTone = "danger" | "neutral" | "success" | "warning";

/** The glyph and tone of a timeline row's leading circle. */
export type EventGlyph = {
  readonly icon:
    | "arrow-undo"
    | "ban"
    | "checkmark"
    | "close"
    | "construct-outline"
    | "ellipse-outline"
    | "eye-outline"
    | "git-commit-outline"
    | "git-pull-request-outline"
    | "lock-open-outline"
    | "remove";
  readonly tone: EventTone;
};

const VERDICT_GLYPHS: Readonly<Record<ReviewVerdict, EventGlyph>> = {
  approvalWithdrawn: { icon: "arrow-undo", tone: "warning" },
  approved: { icon: "checkmark", tone: "success" },
  // A no-entry sign: the reviewer stops the change until it is reworked.
  changesRequested: { icon: "remove", tone: "danger" },
  commented: { icon: "eye-outline", tone: "neutral" },
  dismissed: { icon: "close", tone: "neutral" },
  mergeBlocked: { icon: "ban", tone: "danger" },
  mergeUnblocked: { icon: "lock-open-outline", tone: "success" },
};

/** Events carry no outcome, so their circle stays neutral and names only the subject. */
const EVENT_GLYPHS: Readonly<Record<EventCategory, EventGlyph>> = {
  ci: { icon: "construct-outline", tone: "neutral" },
  other: { icon: "ellipse-outline", tone: "neutral" },
  push: { icon: "git-commit-outline", tone: "neutral" },
  state: { icon: "git-pull-request-outline", tone: "neutral" },
};

/** The leading circle of a review's verdict row. */
export function verdictGlyph(verdict: ReviewVerdict): EventGlyph {
  return VERDICT_GLYPHS[verdict];
}

/** The leading circle of an event row. */
export function eventGlyph(category: EventCategory): EventGlyph {
  return EVENT_GLYPHS[category];
}

/** The verdict as a phrase after the reviewer's login, for a compact verdict row. */
const VERDICT_PHRASES: Readonly<Record<ReviewVerdict, string>> = {
  approvalWithdrawn: "withdrew their approval",
  approved: "approved these changes",
  changesRequested: "requested changes",
  commented: "reviewed",
  dismissed: "had a review dismissed",
  mergeBlocked: "blocked merging",
  mergeUnblocked: "unblocked merging",
};

const EVENT_RUN_LABELS: Readonly<Record<EventCategory, (count: number) => string>> = {
  ci: (count) => `${String(count)} CI updates`,
  other: (count) => `${String(count)} events`,
  push: (count) => `${String(count)} updates pushed`,
  state: (count) => `${String(count)} state changes`,
};

/** Forge comment bodies embed their images inline, so they carry no separate attachments. */
export function commentContent(comment: ConversationComment): MessageContent {
  return { attachments: [], markdown: comment.body };
}

/** The forge author as the message model's author: bots and AI reviewers carry a marker. */
export function messageAuthor(author: ConversationAuthor): MessageAuthor {
  return {
    avatarUrl: author.avatarUrl,
    login: author.login,
    marker: author.kind === "user" ? null : author.kind,
  };
}

/** The comment's reactions as emoji with counts. */
export function commentReactions(comment: ConversationComment): readonly MessageReaction[] {
  return comment.reactions.map((reaction) => ({
    count: reaction.count,
    emoji: REACTION_EMOJI[reaction.content],
    key: reaction.content,
    viewerReacted: reaction.viewerReacted,
  }));
}

/** `dana approved these changes`: a verdict without text as one line. */
export function verdictPhrase(verdict: ReviewVerdict): string {
  return VERDICT_PHRASES[verdict];
}

/** The collapsed label of a run of same-category events, for example "6 updates pushed". */
export function eventRunLabel(category: EventCategory, count: number): string {
  return EVENT_RUN_LABELS[category](count);
}

/** `src/file.rs:42`, `src/file.rs:40-42`, the bare path, or `Pull request` for a PR-level thread. */
export function anchorLabel(anchor: ThreadAnchor): string {
  if (anchor.kind === "pullRequest") {
    return "Pull request";
  }
  if (anchor.kind === "file") {
    return anchor.path;
  }
  const end = String(anchor.line);
  return anchor.startLine === null
    ? `${anchor.path}:${end}`
    : `${anchor.path}:${String(anchor.startLine)}-${end}`;
}

const MARKDOWN_LEAD = /^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)+/u;

/** The first non-empty line of a Markdown body without its block markers, for a one-line preview. */
export function firstLine(markdown: string): string {
  for (const line of markdown.split("\n")) {
    const text = line.trim().replace(MARKDOWN_LEAD, "").trim();
    if (text.length > 0 && !text.startsWith("```") && !text.startsWith("~~~")) {
      return text;
    }
  }
  return "";
}
