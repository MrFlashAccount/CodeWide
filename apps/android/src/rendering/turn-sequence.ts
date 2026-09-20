import type { RenderBlock } from "@codewide/renderers";

export type TurnSequencePart =
  | { block: RenderBlock; key: string; kind: "agent" }
  | { blocks: RenderBlock[]; followedByAgent: boolean; key: string; kind: "activity" };

export type ActiveTurnSequencePart =
  | TurnSequencePart
  | { indexes: number[]; key: string; kind: "collapsedActivity" };

export type CompletedTurnContent = {
  finalAnswer: RenderBlock | null;
  history: RenderBlock[];
};

const ACTIVE_SEQUENCE_CACHE_MAX_ENTRIES = 64;
const activeSequenceCache = new Map<string, ActiveTurnSequencePart[]>();
type ActiveSequenceBuilder = {
  collapsed: number[];
  liveBlocks: RenderBlock[];
  runKey: string;
  sequenceScope: string;
};

export function chronologicalTurnSequence(blocks: RenderBlock[]): TurnSequencePart[] {
  const parts: TurnSequencePart[] = [];
  let activity: RenderBlock[] = [];

  const flushActivity = (followedByAgent: boolean) => {
    const first = activity[0];
    if (first === undefined) {
      return;
    }
    parts.push({
      blocks: activity,
      followedByAgent,
      key: `activity:${first.key}`,
      kind: "activity",
    });
    activity = [];
  };

  for (const block of blocks) {
    if (block.kind === "userMessage") {
      continue;
    }
    if (block.kind === "agentMessage" && (block.body ?? "").trim() !== "") {
      flushActivity(true);
      parts.push({ block, key: `agent:${block.key}`, kind: "agent" });
      continue;
    }
    if (block.kind !== "agentMessage") {
      activity.push(block);
    }
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
  liveEntries: Array<{ block: RenderBlock; index: number }>,
  collapsedIndexes: number[],
  sequenceScope: string,
): ActiveTurnSequencePart[] {
  const parts: ActiveTurnSequencePart[] = [];
  const liveByIndex = new Map(liveEntries.map((entry) => [entry.index, entry.block]));
  const orderedIndexes = [...collapsedIndexes, ...liveEntries.map((entry) => entry.index)].sort(
    (left, right) => left - right,
  );
  const builder: ActiveSequenceBuilder = {
    collapsed: [],
    liveBlocks: [],
    runKey: `activity:${sequenceScope}:start`,
    sequenceScope,
  };

  for (const index of orderedIndexes) {
    const block = liveByIndex.get(index);
    if (block === undefined) {
      builder.collapsed.push(index);
    } else {
      appendActiveSequenceBlock(parts, builder, block);
    }
  }
  flushActivityRun(parts, builder, false);
  return retainUnchangedSequenceParts(sequenceScope, parts);
}

function appendActiveSequenceBlock(
  parts: ActiveTurnSequencePart[],
  builder: ActiveSequenceBuilder,
  block: RenderBlock,
): void {
  if (block.kind === "agentMessage" && (block.body ?? "").trim() !== "") {
    flushActivityRun(parts, builder, true);
    parts.push({ block, key: `agent:${block.key}`, kind: "agent" });
    builder.runKey = `activity:${builder.sequenceScope}:after:${block.key}`;
    return;
  }
  if (block.kind !== "userMessage" && block.kind !== "agentMessage") {
    builder.liveBlocks.push(block);
  }
}

function flushActivityRun(
  parts: ActiveTurnSequencePart[],
  builder: ActiveSequenceBuilder,
  followedByAgent: boolean,
): void {
  if (builder.collapsed.length > 0) {
    parts.push({
      indexes: builder.collapsed,
      key: `${builder.runKey}:collapsed`,
      kind: "collapsedActivity",
    });
  }
  if (builder.liveBlocks.length > 0) {
    parts.push({
      blocks: builder.liveBlocks,
      followedByAgent,
      key: `${builder.runKey}:live`,
      kind: "activity",
    });
  }
  builder.collapsed = [];
  builder.liveBlocks = [];
}

function retainUnchangedSequenceParts(
  sequenceScope: string,
  next: ActiveTurnSequencePart[],
): ActiveTurnSequencePart[] {
  const previous = activeSequenceCache.get(sequenceScope);
  const previousByKey = new Map(previous?.map((part) => [part.key, part] as const) ?? []);
  const retained = next.map((part) => {
    const candidate = previousByKey.get(part.key);
    return candidate !== undefined && sameSequencePart(candidate, part) ? candidate : part;
  });
  const value = previous !== undefined && sameReferences(previous, retained) ? previous : retained;
  activeSequenceCache.delete(sequenceScope);
  activeSequenceCache.set(sequenceScope, value);
  while (activeSequenceCache.size > ACTIVE_SEQUENCE_CACHE_MAX_ENTRIES) {
    const oldest = activeSequenceCache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    activeSequenceCache.delete(oldest);
  }
  return value;
}

function sameSequencePart(previous: ActiveTurnSequencePart, next: ActiveTurnSequencePart): boolean {
  if (previous.kind !== next.kind) {
    return false;
  }
  if (previous.kind === "agent") {
    return sameAgentSequencePart(previous, next);
  }
  if (previous.kind === "activity") {
    return sameActivitySequencePart(previous, next);
  }
  return sameCollapsedSequencePart(previous, next);
}

function sameAgentSequencePart(
  previous: Extract<ActiveTurnSequencePart, { kind: "agent" }>,
  next: ActiveTurnSequencePart,
): boolean {
  if (next.kind !== "agent") {
    return false;
  }
  return previous.block === next.block;
}

function sameActivitySequencePart(
  previous: Extract<ActiveTurnSequencePart, { kind: "activity" }>,
  next: ActiveTurnSequencePart,
): boolean {
  if (next.kind !== "activity") {
    return false;
  }
  if (previous.followedByAgent !== next.followedByAgent) {
    return false;
  }
  return sameReferences(previous.blocks, next.blocks);
}

function sameCollapsedSequencePart(
  previous: Extract<ActiveTurnSequencePart, { kind: "collapsedActivity" }>,
  next: ActiveTurnSequencePart,
): boolean {
  if (next.kind !== "collapsedActivity") {
    return false;
  }
  return sameNumbers(previous.indexes, next.indexes);
}

function sameReferences<Value>(previous: readonly Value[], next: readonly Value[]): boolean {
  return previous.length === next.length && previous.every((value, index) => value === next[index]);
}

function sameNumbers(previous: readonly number[], next: readonly number[]): boolean {
  return previous.length === next.length && previous.every((value, index) => value === next[index]);
}

export function completedTurnContent(blocks: RenderBlock[]): CompletedTurnContent {
  const content = blocks.filter((block) => block.kind !== "userMessage");
  let finalIndex = -1;
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const block = content[index];
    if (block?.kind !== "agentMessage" || (block.body ?? "").trim() === "") {
      continue;
    }
    const phase = typeof block.raw.phase === "string" ? block.raw.phase : block.status;
    if (phase === "final_answer") {
      finalIndex = index;
      break;
    }
    if (finalIndex === -1) {
      finalIndex = index;
    }
  }
  const finalAnswer = finalIndex === -1 ? null : (content[finalIndex] ?? null);
  return {
    finalAnswer,
    history: content.filter((_block, index) => index !== finalIndex),
  };
}
