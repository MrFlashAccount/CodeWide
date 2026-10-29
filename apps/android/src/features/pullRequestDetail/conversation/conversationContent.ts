/**
 * Maps the forge conversation DTOs into the forge-independent message model.
 * The forge reaction vocabulary becomes emoji here, so `features/messageContent`
 * never learns a forge's names.
 */
import type {
  ConversationAuthor,
  ConversationComment,
  EventCategory,
  IssueState,
  ReactionContent,
  ReviewVerdict,
  ThreadAnchor,
} from "../../../data/forgeConversationContract";
import type { CaptionBadgeTone } from "../../../ui/CaptionBadge";
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

const VERDICT_LABELS: Readonly<Record<ReviewVerdict, string>> = {
  approvalWithdrawn: "Approval withdrawn",
  approved: "Approved",
  changesRequested: "Changes requested",
  commented: "Reviewed",
  dismissed: "Dismissed",
  mergeBlocked: "Blocks merge",
  mergeUnblocked: "Unblocked",
};

const VERDICT_TONES: Readonly<Record<ReviewVerdict, CaptionBadgeTone>> = {
  approvalWithdrawn: "warning",
  approved: "success",
  changesRequested: "danger",
  commented: "neutral",
  dismissed: "neutral",
  mergeBlocked: "danger",
  mergeUnblocked: "success",
};

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

const ISSUE_LABELS: Readonly<Record<IssueState, string>> = {
  dropped: "Dropped",
  open: "Open issue",
  resolved: "Resolved",
};

const ISSUE_TONES: Readonly<Record<IssueState, CaptionBadgeTone>> = {
  dropped: "neutral",
  open: "danger",
  resolved: "success",
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

/** A review verdict as the pill beside its author. */
export function verdictLabel(verdict: ReviewVerdict): string {
  return VERDICT_LABELS[verdict];
}

/** The pill tone of a verdict; color always pairs with the label. */
export function verdictTone(verdict: ReviewVerdict): CaptionBadgeTone {
  return VERDICT_TONES[verdict];
}

/** `dana approved these changes`: a verdict without text as one line. */
export function verdictPhrase(verdict: ReviewVerdict): string {
  return VERDICT_PHRASES[verdict];
}

/** The collapsed label of a run of same-category events, for example "6 updates pushed". */
export function eventRunLabel(category: EventCategory, count: number): string {
  return EVENT_RUN_LABELS[category](count);
}

/** An issue's state as its badge label and tone. */
export function issueBadge(state: IssueState): {
  readonly label: string;
  readonly tone: CaptionBadgeTone;
} {
  return { label: ISSUE_LABELS[state], tone: ISSUE_TONES[state] };
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
