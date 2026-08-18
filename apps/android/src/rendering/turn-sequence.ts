import type { RenderBlock } from "@codewide/renderers";

export type TurnSequencePart =
  | { kind: "agent"; key: string; block: RenderBlock }
  | { kind: "activity"; key: string; blocks: RenderBlock[]; followedByAgent: boolean };

export type ActiveTurnSequencePart =
  | TurnSequencePart
  | { kind: "collapsedActivity"; key: string; indexes: number[] };

export type CompletedTurnContent = {
  finalAnswer: RenderBlock | null;
  history: RenderBlock[];
};

export function chronologicalTurnSequence(blocks: RenderBlock[]): TurnSequencePart[] {
  const parts: TurnSequencePart[] = [];
  let activity: RenderBlock[] = [];

  const flushActivity = (followedByAgent: boolean) => {
    const first = activity[0];
    if (first === undefined) return;
    parts.push({
      kind: "activity",
      key: `activity:${first.key}`,
      blocks: activity,
      followedByAgent,
    });
    activity = [];
  };

  for (const block of blocks) {
    if (block.kind === "userMessage") continue;
    if (block.kind === "agentMessage" && (block.body ?? "").trim() !== "") {
      flushActivity(true);
      parts.push({ kind: "agent", key: `agent:${block.key}`, block });
      continue;
    }
    if (block.kind !== "agentMessage") activity.push(block);
  }
  flushActivity(false);
  return parts;
}

/**
 * Restores the active turn's wire order after the render window has replaced
 * old activity cards with cheap collapsed ranges. Agent progress messages stay
 * visible and continue to separate the activity that happened around them.
 */
export function activeTurnSequence(
  liveEntries: Array<{ index: number; block: RenderBlock }>,
  collapsedIndexes: number[],
): ActiveTurnSequencePart[] {
  const parts: ActiveTurnSequencePart[] = [];
  const liveByIndex = new Map(liveEntries.map((entry) => [entry.index, entry.block]));
  const orderedIndexes = [...collapsedIndexes, ...liveEntries.map((entry) => entry.index)]
    .sort((left, right) => left - right);
  let liveBlocks: RenderBlock[] = [];
  let collapsed: number[] = [];

  const flushLive = () => {
    if (liveBlocks.length === 0) return;
    parts.push(...chronologicalTurnSequence(liveBlocks));
    liveBlocks = [];
  };
  const flushCollapsed = () => {
    const first = collapsed[0];
    if (first === undefined) return;
    parts.push({ kind: "collapsedActivity", key: `collapsed:${first}`, indexes: collapsed });
    collapsed = [];
  };

  for (const index of orderedIndexes) {
    const block = liveByIndex.get(index);
    if (block === undefined) {
      flushLive();
      collapsed.push(index);
    } else {
      flushCollapsed();
      liveBlocks.push(block);
    }
  }
  flushCollapsed();
  flushLive();
  return parts;
}

export function completedTurnContent(blocks: RenderBlock[]): CompletedTurnContent {
  const content = blocks.filter((block) => block.kind !== "userMessage");
  let finalIndex = -1;
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const block = content[index];
    if (block?.kind !== "agentMessage" || (block.body ?? "").trim() === "") continue;
    const phase = typeof block.raw.phase === "string" ? block.raw.phase : block.status;
    if (phase === "final_answer") {
      finalIndex = index;
      break;
    }
    if (finalIndex === -1) finalIndex = index;
  }
  const finalAnswer = finalIndex === -1 ? null : content[finalIndex] ?? null;
  return {
    finalAnswer,
    history: content.filter((_block, index) => index !== finalIndex),
  };
}
