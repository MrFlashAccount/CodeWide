import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

type Turn = Thread["turns"][number];

export const LIVE_ACTIVITY_WINDOW = 16;

export type TurnRenderWindow = {
  userItemIndexes: number[];
  latestAgentIndex: number;
  collapsedActivityIndexes: number[];
  liveActivityIndexes: number[];
};

export function isTurnActivityItem(item: Turn["items"][number]): boolean {
  return item.type !== "userMessage";
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
  const userItemIndexes: number[] = [];
  let latestAgentIndex = -1;
  let explicitFinalAgentIndex = -1;
  let latestNonUserIndex = -1;

  for (let index = 0; index < turn.items.length; index += 1) {
    const item = turn.items[index];
    if (item?.type === "userMessage") userItemIndexes.push(index);
    else if (item !== undefined) {
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
    if (item === undefined || !isTurnActivityItem(item)) continue;
    // Thinking is ephemeral presentation state, not historical activity. Keep
    // the underlying item in storage, but only materialize it while it is the
    // newest thing in an active turn. The first tool or agent message that
    // follows it removes it from the render window without mutating history.
    if (item.type === "reasoning" && (turn.status !== "inProgress" || index !== latestNonUserIndex)) continue;
    materializedIndexes.push(index);
  }

  if (turn.status !== "inProgress") {
    return {
      userItemIndexes,
      latestAgentIndex,
      collapsedActivityIndexes: materializedIndexes.filter((index) => index !== latestAgentIndex),
      liveActivityIndexes: [],
    };
  }

  const agentIndexes = materializedIndexes.filter((index) => {
    const item = turn.items[index];
    // App Server streams the final_answer item while the turn is still active.
    // Hiding that phase until turn/completed turns a real token stream into one
    // large visual jump at the boundary.
    return item?.type === "agentMessage" && item.text.trim() !== "";
  });
  const activityIndexes = materializedIndexes.filter((index) => turn.items[index]?.type !== "agentMessage");
  const liveCount = Math.max(0, Math.min(liveActivityLimit, activityIndexes.length));
  const liveActivityIndexes = [
    ...agentIndexes,
    ...(liveCount === 0 ? [] : activityIndexes.slice(-liveCount)),
  ].sort((left, right) => left - right);
  const liveIndexSet = new Set(liveActivityIndexes);

  return {
    userItemIndexes,
    latestAgentIndex,
    collapsedActivityIndexes: activityIndexes.filter((index) => !liveIndexSet.has(index)),
    liveActivityIndexes,
  };
}
