import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

type Turn = Thread["turns"][number];

export const LIVE_ACTIVITY_WINDOW = 16;

export type TurnRenderWindow = {
  userItemIndexes: number[];
  preTurnActivityIndexes: number[];
  compactionIndexes: number[];
  latestAgentIndex: number;
  collapsedActivityIndexes: number[];
  liveActivityIndexes: number[];
};

export function isTurnActivityItem(item: Turn["items"][number]): boolean {
  return item.type !== "userMessage";
}

/**
 * An active turn can contain several already-completed agent updates followed
 * by tool activity. Only the newest agent item may still receive text deltas;
 * older messages must expose their full tail instead of looking truncated for
 * the remainder of a long-running tool call.
 */
export function isAgentMessageStillStreaming(turn: Turn, itemId: string): boolean {
  if (turn.status !== "inProgress") return false;
  const itemIndex = turn.items.findIndex((item) => item.id === itemId && item.type === "agentMessage");
  if (itemIndex < 0) return false;
  return !turn.items.slice(itemIndex + 1).some((item) => item.type !== "userMessage");
}

/**
 * Selects the bounded part of a turn that must be materialized as rich UI.
 * Completed turns keep only the final agent message outside collapsed history.
 * Active turns keep every textual agent update visible in wire order while
 * bounding the number of rich activity cards. Older activity remains available
 * through collapsed summaries between those updates. A tool-only turn therefore
 * still keeps only its tail live so streaming cost cannot grow with the lifetime
 * of the turn.
 */
export function selectTurnRenderWindow(
  turn: Turn,
  liveActivityLimit = LIVE_ACTIVITY_WINDOW,
): TurnRenderWindow {
  const hiddenPlaceholderIndexes = matchingAgentPlaceholderIndexes(turn);
  const userItemIndexes: number[] = [];
  let latestAgentIndex = -1;
  let explicitFinalAgentIndex = -1;
  let latestNonUserIndex = -1;

  for (let index = 0; index < turn.items.length; index += 1) {
    const item = turn.items[index];
    if (item?.type === "userMessage") userItemIndexes.push(index);
    else if (item !== undefined && !hiddenPlaceholderIndexes.has(index)) {
      latestNonUserIndex = index;
      if (item.type === "agentMessage" && item.text.trim() !== "") {
        latestAgentIndex = index;
        if (item.phase === "final_answer") explicitFinalAgentIndex = index;
      }
    }
  }

  if (turn.status !== "inProgress" && explicitFinalAgentIndex >= 0) {
    latestAgentIndex = explicitFinalAgentIndex;
  }

  const materializedIndexes: number[] = [];
  for (let index = 0; index < turn.items.length; index += 1) {
    const item = turn.items[index];
    if (item === undefined || hiddenPlaceholderIndexes.has(index) || !isTurnActivityItem(item)) continue;
    // Thinking is ephemeral presentation state, not historical activity. Keep
    // the underlying item in storage, but only materialize it while it is the
    // newest thing in an active turn. The first tool or agent message that
    // follows it removes it from the render window without mutating history.
    if (item.type === "reasoning" && (turn.status !== "inProgress" || index !== latestNonUserIndex)) continue;
    materializedIndexes.push(index);
  }

  // App Server may perform work before it materializes the canonical user
  // message. Keep that pre-turn activity in the response bubble. A context
  // compaction is presented outside only when it belongs to that pre-turn
  // lifecycle; a compaction after the user boundary belongs inside the turn.
  const firstUserIndex = userItemIndexes[0] ?? Number.POSITIVE_INFINITY;
  const compactionIndexes = materializedIndexes.filter((index) => {
    const item = turn.items[index];
    return item?.type === "contextCompaction"
      && (index < firstUserIndex || isProjectedPreTurn(item));
  });
  const preTurnActivityIndexes = materializedIndexes.filter((index) => {
    const item = turn.items[index];
    return item?.type !== "contextCompaction"
      && (index < firstUserIndex || isProjectedPreTurn(item));
  });
  const separatedIndexSet = new Set([...preTurnActivityIndexes, ...compactionIndexes]);

  if (turn.status !== "inProgress") {
    return {
      userItemIndexes,
      preTurnActivityIndexes,
      compactionIndexes,
      latestAgentIndex,
      collapsedActivityIndexes: materializedIndexes.filter((index) => (
        index !== latestAgentIndex && !separatedIndexSet.has(index)
      )),
      liveActivityIndexes: [],
    };
  }

  const agentIndexes = materializedIndexes.filter((index) => {
    const item = turn.items[index];
    // App Server streams the final_answer item while the turn is still active.
    // Hiding that phase until turn/completed turns a real token stream into one
    // large visual jump at the boundary.
    return !separatedIndexSet.has(index) && item?.type === "agentMessage" && item.text.trim() !== "";
  });
  const activityIndexes = materializedIndexes.filter((index) => (
    turn.items[index]?.type !== "agentMessage" && !separatedIndexSet.has(index)
  ));
  const liveCount = Math.max(0, Math.min(liveActivityLimit, activityIndexes.length));
  const liveActivityIndexes = [
    ...agentIndexes,
    ...(liveCount === 0 ? [] : activityIndexes.slice(-liveCount)),
  ].sort((left, right) => left - right);
  const liveIndexSet = new Set(liveActivityIndexes);

  return {
    userItemIndexes,
    preTurnActivityIndexes,
    compactionIndexes,
    latestAgentIndex,
    collapsedActivityIndexes: activityIndexes.filter((index) => !liveIndexSet.has(index)),
    liveActivityIndexes,
  };
}

function isProjectedPreTurn(item: Turn["items"][number] | undefined): boolean {
  return item !== undefined && "codewidePreTurn" in item && item.codewidePreTurn === true;
}

function matchingAgentPlaceholderIndexes(turn: Turn): Set<number> {
  const hidden = new Set<number>();
  const placeholderId = `${turn.id}:agent`;
  const placeholderIndex = turn.items.findIndex((item) => (
    item.type === "agentMessage" && item.id === placeholderId
  ));
  if (placeholderIndex === -1) return hidden;
  const placeholder = turn.items[placeholderIndex];
  if (placeholder?.type !== "agentMessage") return hidden;
  const hasCanonicalMatch = turn.items.some((item, index) => (
    index !== placeholderIndex
    && item.type === "agentMessage"
    && item.id !== placeholderId
    && (item.text === placeholder.text
      || (item.phase === "final_answer" && placeholder.phase === "final_answer"))
  ));
  if (hasCanonicalMatch) hidden.add(placeholderIndex);
  return hidden;
}
