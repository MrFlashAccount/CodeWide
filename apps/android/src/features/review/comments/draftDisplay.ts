import type { CaptionBadgeTone } from "../../../ui/CaptionBadge";
import type { AgentAxis, DraftComment, PrAxis } from "../../../data/reviewDraftContract";

/** One per-axis badge of a draft. */
export type DraftBadge = {
  readonly label: string;
  readonly shimmer: boolean;
  readonly tone: CaptionBadgeTone;
};

/**
 * One badge per active axis: "Both" shows both. Labels follow the copy
 * inventory: Published, Not sent, Outdated, Sent to agent, Failed · Retry.
 */
export function draftBadges(draft: DraftComment, host: string | null): readonly DraftBadge[] {
  const badges: DraftBadge[] = [];
  if (draft.destination === "pr" || draft.destination === "both") {
    badges.push(prBadge(draft.pr.state, host));
  }
  if (draft.destination === "agent" || draft.destination === "both") {
    badges.push(AGENT_BADGES[draft.agent.state]);
  }
  return badges;
}

const AGENT_BADGES: Readonly<Record<AgentAxis["state"], DraftBadge>> = {
  failed: { label: "Failed · Retry", shimmer: false, tone: "danger" },
  pending: { label: "Agent", shimmer: false, tone: "neutral" },
  sent: { label: "Sent to agent", shimmer: false, tone: "success" },
};

const PR_BADGES: Readonly<Record<Exclude<PrAxis["state"], "published">, DraftBadge>> = {
  failed: { label: "Not sent", shimmer: false, tone: "danger" },
  outdated: { label: "Outdated", shimmer: false, tone: "warning" },
  pending: { label: "PR", shimmer: false, tone: "neutral" },
  submitting: { label: "PR", shimmer: true, tone: "neutral" },
};

function prBadge(state: PrAxis["state"], host: string | null): DraftBadge {
  if (state !== "published") {
    return PR_BADGES[state];
  }
  return {
    label: host === null ? "Published" : `Published · ${host}`,
    shimmer: false,
    tone: "success",
  };
}

/** `You · line 210` or `Agent · lines 12–18`. */
export function draftLocation(draft: DraftComment): string {
  const who = draft.author.kind === "user" ? "You" : "Agent";
  const { endLine, startLine } = draft.anchor;
  return startLine === endLine
    ? `${who} · line ${String(startLine)}`
    : `${who} · lines ${String(startLine)}–${String(endLine)}`;
}

/** A published PR axis makes the draft read-only. */
export function isReadOnly(draft: DraftComment): boolean {
  return (
    (draft.destination === "pr" || draft.destination === "both") && draft.pr.state === "published"
  );
}

/** The draft's agent half still waits to be sent (or can be retried). */
export function canSendToAgent(draft: DraftComment): boolean {
  return (
    (draft.destination === "agent" || draft.destination === "both") && draft.agent.state !== "sent"
  );
}

/** The PR half could not be re-anchored after a push and waits for the user. */
export function isOutdated(draft: DraftComment): boolean {
  return (
    (draft.destination === "pr" || draft.destination === "both") && draft.pr.state === "outdated"
  );
}
