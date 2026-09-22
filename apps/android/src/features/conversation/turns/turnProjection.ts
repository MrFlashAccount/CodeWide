/** V1 turnProjection owner, extracted without changing interaction or resource lifetime. */
import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import { connectionId, normalizeThreadItem } from "@codewide/domain";
import { toRenderBlock, type RenderBlock } from "@codewide/renderers";
import { projectedQuestionHistory, projectedTurnMetadata } from "@codewide/sync-client";
import { selectTurnRenderWindow } from "../../../rendering/thread-render-window";
import type { TurnSequencePart } from "../../../rendering/turn-sequence";
import { isToolActivityKind } from "../protocol/protocolKind";
import type { TimelineItem } from "../timeline/timelineTypes";

export type CachedTurnProjection = {
  compactionBlocks: RenderBlock[];
  latestAgentBlock: RenderBlock | null;
  liveActivityBlocks: RenderBlock[];
  preTurnBlocks: RenderBlock[];
  renderWindow: ReturnType<typeof selectTurnRenderWindow>;
  userBlocks: RenderBlock[];
};

type CachedRenderBlock = { key: string; value: RenderBlock };
type RawTurnItem = Thread["turns"][number]["items"][number];

const TURN_PROJECTION_CACHE_MAX_ENTRIES = 64;
const TURN_PROJECTION_REFERENCE_FIELDS = [
  "compactionBlocks",
  "latestAgentBlock",
  "liveActivityBlocks",
  "preTurnBlocks",
  "renderWindow",
  "userBlocks",
] as const;
const RENDER_WINDOW_REFERENCE_FIELDS = [
  "collapsedActivityIndexes",
  "compactionIndexes",
  "liveActivityIndexes",
  "preTurnActivityIndexes",
  "userItemIndexes",
] as const;
const renderBlockCache = new WeakMap<RawTurnItem, CachedRenderBlock>();
const turnProjectionCache = new Map<string, CachedTurnProjection>();

export function projectTurnProjection(
  turn: Extract<TimelineItem, { kind: "turn" }>,
): CachedTurnProjection {
  const rawTurn = turn.turn;
  const renderWindow = selectTurnRenderWindow(rawTurn);
  const userBlocks = renderWindow.userItemIndexes.flatMap((index) => {
    const item = rawTurn.items[index];
    return item === undefined ? [] : [projectThreadItem(turn, item, index)];
  });
  const preTurnBlocks = renderWindow.preTurnActivityIndexes.flatMap((index) => {
    const item = rawTurn.items[index];
    return item === undefined ? [] : [projectThreadItem(turn, item, index)];
  });
  const compactionBlocks = renderWindow.compactionIndexes.flatMap((index) => {
    const item = rawTurn.items[index];
    return item === undefined ? [] : [projectThreadItem(turn, item, index)];
  });
  const latestAgentItem =
    renderWindow.latestAgentIndex < 0 ? undefined : rawTurn.items[renderWindow.latestAgentIndex];
  const latestAgentBlock =
    latestAgentItem === undefined
      ? null
      : projectThreadItem(turn, latestAgentItem, renderWindow.latestAgentIndex);
  const liveActivityBlocks = renderWindow.liveActivityIndexes.flatMap((index) => {
    const item = rawTurn.items[index];
    return item === undefined ? [] : [projectThreadItem(turn, item, index)];
  });
  return retainTurnProjection(turn.key, {
    compactionBlocks,
    latestAgentBlock,
    liveActivityBlocks,
    preTurnBlocks,
    renderWindow,
    userBlocks,
  });
}

function retainTurnProjection(key: string, next: CachedTurnProjection): CachedTurnProjection {
  const previous = turnProjectionCache.get(key);
  if (previous === undefined) {
    storeTurnProjection(key, next);
    return next;
  }
  const value: CachedTurnProjection = {
    compactionBlocks: retainReferences(previous.compactionBlocks, next.compactionBlocks),
    latestAgentBlock: next.latestAgentBlock,
    liveActivityBlocks: retainReferences(previous.liveActivityBlocks, next.liveActivityBlocks),
    preTurnBlocks: retainReferences(previous.preTurnBlocks, next.preTurnBlocks),
    renderWindow: retainRenderWindow(previous.renderWindow, next.renderWindow),
    userBlocks: retainReferences(previous.userBlocks, next.userBlocks),
  };
  const retained = projectionReferencesEqual(previous, value) ? previous : value;
  storeTurnProjection(key, retained);
  return retained;
}

function storeTurnProjection(key: string, value: CachedTurnProjection): void {
  turnProjectionCache.delete(key);
  turnProjectionCache.set(key, value);
  while (turnProjectionCache.size > TURN_PROJECTION_CACHE_MAX_ENTRIES) {
    const oldest = turnProjectionCache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    turnProjectionCache.delete(oldest);
  }
}

function retainRenderWindow(
  previous: CachedTurnProjection["renderWindow"] | undefined,
  next: CachedTurnProjection["renderWindow"],
): CachedTurnProjection["renderWindow"] {
  if (
    previous !== undefined &&
    previous.latestAgentIndex === next.latestAgentIndex &&
    RENDER_WINDOW_REFERENCE_FIELDS.every((field) => sameValues(previous[field], next[field]))
  ) {
    return previous;
  }
  return next;
}

function projectionReferencesEqual(
  previous: CachedTurnProjection,
  next: CachedTurnProjection,
): boolean {
  return TURN_PROJECTION_REFERENCE_FIELDS.every((field) => previous[field] === next[field]);
}

function retainReferences<Value>(previous: Value[] | undefined, next: Value[]): Value[] {
  return previous !== undefined && sameValues(previous, next) ? previous : next;
}

function sameValues<Value>(previous: readonly Value[], next: readonly Value[]): boolean {
  return previous.length === next.length && previous.every((value, index) => value === next[index]);
}

export function preTurnBlockUsesDisclosure(block: RenderBlock): boolean {
  return block.body !== null || isToolActivityKind(block.kind);
}

export function activitySegmentUsesDisclosure(
  part: Extract<TurnSequencePart, { kind: "activity" }>,
): boolean {
  const thinkingOnly =
    part.blocks.length > 0 && part.blocks.every((block) => block.kind === "reasoning");
  const agentNavigationOnly =
    part.blocks.length > 0 &&
    part.blocks.every(
      (block) => block.kind === "collabAgentToolCall" || block.kind === "subAgentActivity",
    );
  return !thinkingOnly && !agentNavigationOnly;
}

export function projectThreadItem(
  row: Extract<TimelineItem, { kind: "turn" }>,
  rawItem: Thread["turns"][number]["items"][number],
  index: number,
): RenderBlock {
  const normalized = normalizeThreadItem(
    connectionId(row.connectionId),
    row.threadId,
    row.turn.id,
    rawItem,
    index,
  );
  const cached = renderBlockCache.get(rawItem);
  if (cached?.key === normalized.key) {
    return cached.value;
  }
  const value = toRenderBlock(normalized);
  renderBlockCache.set(rawItem, { key: normalized.key, value });
  return value;
}

export function completedActivityItemCount(turn: Thread["turns"][number]): number {
  return Math.max(
    selectTurnRenderWindow(turn).collapsedActivityIndexes.length,
    projectedTurnMetadata(turn)?.activity?.count ?? 0,
  );
}

export function turnMetadataKinds(turn: Thread["turns"][number]): string[] {
  const metadata = projectedTurnMetadata(turn);
  if (metadata === null) {
    return [];
  }
  return [
    ...(metadata.plan === undefined ? [] : ["turnPlan"]),
    ...(metadata.diff === undefined ? [] : ["turnDiff"]),
  ];
}

export function turnActivityLabel(kinds: string[], compact = false): string {
  const labels: string[] = [];
  if (kinds.some((kind) => kind === "fileChange" || kind === "turnDiff" || kind === "diff")) {
    labels.push("Edited files");
  }
  if (kinds.some((kind) => kind === "commandExecution" || kind === "terminal")) {
    labels.push("ran commands");
  }
  if (kinds.some((kind) => kind === "webSearch")) {
    labels.push("searched web");
  }
  if (
    kinds.some((kind) => kind === "mcpToolCall" || kind === "dynamicToolCall" || kind === "tool")
  ) {
    labels.push("used tools");
  }
  if (kinds.some((kind) => kind === "collabAgentToolCall" || kind === "subAgentActivity")) {
    labels.push("coordinated agents");
  }
  if (compact) {
    const shortLabels = labels
      .slice(0, 2)
      .map((label) => (label === "coordinated agents" ? "agents" : label));
    return `${shortLabels.length === 0 ? "Activity" : shortLabels.join(", ")} · ${String(kinds.length)}`;
  }
  if (labels.length === 0) {
    return `${String(kinds.length)} ${kinds.length === 1 ? "activity" : "activities"}`;
  }
  return labels.join(", ");
}

export function turnMetadataBlocks(scope: string, turn: Thread["turns"][number]): RenderBlock[] {
  const metadata = projectedTurnMetadata(turn);
  if (metadata === null) {
    return [];
  }
  const blocks: RenderBlock[] = [];
  if (metadata.plan !== undefined) {
    const completed = metadata.plan.steps.filter((step) => step.status === "completed").length;
    const checklist = metadata.plan.steps
      .map((step) => `${step.status === "completed" ? "- [x]" : "- [ ]"} ${step.step}`)
      .join("\n");
    blocks.push({
      body: [metadata.plan.explanation, checklist]
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .join("\n\n"),
      collapsible: true,
      content: null,
      durationMs: null,
      key: `${scope}/${turn.id}/live-plan`,
      kind: "turnPlan",
      raw: { explanation: metadata.plan.explanation, plan: metadata.plan.steps },
      status: `${String(completed)}/${String(metadata.plan.steps.length)}`,
      title: "Plan",
      tone: "info",
    });
  }
  if (metadata.diff !== undefined) {
    blocks.push({
      body: metadata.diff,
      collapsible: true,
      content: null,
      durationMs: null,
      key: `${scope}/${turn.id}/live-diff`,
      kind: "turnDiff",
      raw: { diff: metadata.diff },
      status: null,
      title: "Turn diff",
      tone: "neutral",
    });
  }
  return blocks;
}

import { projectAgentArtifacts } from "../../../rendering/agent-artifacts";
import {
  attachmentSourceKey,
  type UserMessageAttachment,
} from "../../../rendering/user-message-attachments";
import type { ContentReviewTarget } from "../../../rendering/content-review";
import {
  projectCachedLiveMarkdown,
  type LiveMarkdownProjection,
} from "../../../rendering/live-text-stream";
import { richMarkdownLayout } from "../../../rendering/rich-markdown-layout";
import { isAgentMessageStillStreaming } from "../../../rendering/thread-render-window";
import { activeTurnSequence } from "../../../rendering/turn-sequence";

const agentArtifactCache = new Map<string, UserMessageAttachment[]>();
const visibleAgentPartCache = new WeakMap<
  Extract<TurnSequencePart, { kind: "agent" }>,
  { body: string; value: Extract<TurnSequencePart, { kind: "agent" }> }
>();
/** Builds a turn's visible presentation from the retained projection and current search intent. */
export function projectTurnPresentation(
  turn: Extract<TimelineItem, { kind: "turn" }>,
  searchFocus: { itemId: string } | null,
  forkAvailable: boolean,
  hasPendingRequest: boolean,
) {
  const rawTurn = turn.turn;
  const artifacts = retainAgentArtifacts(turn.key, projectAgentArtifacts(rawTurn));
  const {
    compactionBlocks,
    latestAgentBlock,
    liveActivityBlocks,
    preTurnBlocks,
    renderWindow,
    userBlocks,
  } = projectTurnProjection(turn);
  const searchMessageIndex =
    searchFocus === null
      ? -1
      : rawTurn.items.findIndex(
          (item) => item.id === searchFocus.itemId && item.type === "agentMessage",
        );
  const searchedAgentItem =
    searchMessageIndex < 0 || searchMessageIndex === renderWindow.latestAgentIndex
      ? undefined
      : rawTurn.items[searchMessageIndex];
  const searchedAgentBlock =
    searchedAgentItem === undefined
      ? null
      : projectThreadItem(turn, searchedAgentItem, searchMessageIndex);
  const liveActivityEntries = renderWindow.liveActivityIndexes.flatMap(
    (itemIndex, projectionIndex) => {
      const block = liveActivityBlocks[projectionIndex];
      return block === undefined ? [] : [{ block, index: itemIndex }];
    },
  );
  const liveActivitySequence =
    rawTurn.status === "inProgress"
      ? activeTurnSequence(liveActivityEntries, renderWindow.collapsedActivityIndexes, turn.key)
      : [];
  const liveMarkdownProjections = new Map<string, LiveMarkdownProjection>();
  const visibleLiveActivitySequence = liveActivitySequence.map((part) => {
    if (part.kind !== "agent") {
      return part;
    }
    const itemId = typeof part.block.raw.id === "string" ? part.block.raw.id : null;
    const projection = projectCachedLiveMarkdown(
      part.block.key,
      part.block.body ?? "",
      itemId !== null && !isAgentMessageStillStreaming(rawTurn, itemId),
    );
    liveMarkdownProjections.set(part.block.key, projection);
    return visibleAgentPart(part, projection.visibleSource);
  });
  const latestAgentProjection =
    rawTurn.status === "inProgress" && latestAgentBlock !== null
      ? (liveMarkdownProjections.get(latestAgentBlock.key) ??
        projectCachedLiveMarkdown(latestAgentBlock.key, latestAgentBlock.body ?? ""))
      : null;
  if (latestAgentProjection !== null && latestAgentBlock !== null) {
    liveMarkdownProjections.set(latestAgentBlock.key, latestAgentProjection);
  }
  const latestAgentTextReference = latestAgentBlock?.content?.fields["/text"];
  const hasGeneratedAgentResponse =
    (latestAgentBlock?.body ?? "").trim().length > 0 ||
    (latestAgentTextReference?.byteLength ?? 0) > 0;
  const copyText = latestAgentBlock?.body ?? "";
  const canForkThrough = rawTurn.status !== "inProgress" && forkAvailable;
  const agentReviewTarget: ContentReviewTarget | null =
    latestAgentBlock === null || !hasGeneratedAgentResponse
      ? null
      : {
          id: `agent-response:${latestAgentBlock.key}`,
          label: "Completed agent response",
          reference: latestAgentBlock.key,
        };
  const canReviewResponse = rawTurn.status !== "inProgress" && agentReviewTarget !== null;
  const showMessageActions = copyText !== "" || canForkThrough || canReviewResponse;
  const hasQuestions =
    projectedQuestionHistory(rawTurn).length > 0 ||
    rawTurn.items.some(
      (item) =>
        item.type === "agentMessage" &&
        item.delivery === "async" &&
        (item.questions?.length ?? 0) > 0,
    );
  const showEmptyResponsePlaceholder =
    !hasQuestions &&
    rawTurn.status !== "inProgress" &&
    !hasGeneratedAgentResponse &&
    artifacts.length === 0;
  const completedActivityCount =
    rawTurn.status === "inProgress" ? 0 : completedActivityItemCount(rawTurn);
  const hasDisclosedBubbleActivity =
    preTurnBlocks.some(preTurnBlockUsesDisclosure) ||
    completedActivityCount > 0 ||
    visibleLiveActivitySequence.some(
      (part) =>
        part.kind === "collapsedActivity" ||
        (part.kind === "activity" && activitySegmentUsesDisclosure(part)),
    );
  const agentBubbleFill =
    hasQuestions ||
    artifacts.length > 0 ||
    hasDisclosedBubbleActivity ||
    (latestAgentTextReference?.byteLength ?? 0) > 0 ||
    (hasGeneratedAgentResponse && richMarkdownLayout(latestAgentBlock?.body ?? "") === "fill");
  const hasAgentContent =
    hasQuestions ||
    (rawTurn.status !== "inProgress"
      ? rawTurn.itemsView !== "full" ||
        completedActivityCount > 0 ||
        preTurnBlocks.length > 0 ||
        hasGeneratedAgentResponse
      : visibleLiveActivitySequence.length > 0 ||
        preTurnBlocks.length > 0 ||
        latestAgentBlock !== null) ||
    hasPendingRequest ||
    showEmptyResponsePlaceholder ||
    artifacts.length > 0;
  return {
    agentBubbleFill,
    agentReviewTarget,
    artifacts,
    canForkThrough,
    canReviewResponse,
    compactionBlocks,
    copyText,
    hasAgentContent,
    hasGeneratedAgentResponse,
    latestAgentBlock,
    liveMarkdownProjections,
    preTurnBlocks,
    rawTurn,
    searchedAgentBlock,
    showEmptyResponsePlaceholder,
    showMessageActions,
    userBlocks,
    visibleLiveActivitySequence,
  };
}

function visibleAgentPart(
  part: Extract<TurnSequencePart, { kind: "agent" }>,
  body: string,
): Extract<TurnSequencePart, { kind: "agent" }> {
  if ((part.block.body ?? "") === body) {
    return part;
  }
  const cached = visibleAgentPartCache.get(part);
  if (cached?.body === body) {
    return cached.value;
  }
  const value: Extract<TurnSequencePart, { kind: "agent" }> = {
    ...part,
    block: { ...part.block, body },
  };
  visibleAgentPartCache.set(part, { body, value });
  return value;
}

function retainAgentArtifacts(key: string, next: UserMessageAttachment[]): UserMessageAttachment[] {
  const previous = agentArtifactCache.get(key);
  const value = previous !== undefined && sameAttachments(previous, next) ? previous : next;
  agentArtifactCache.delete(key);
  agentArtifactCache.set(key, value);
  while (agentArtifactCache.size > TURN_PROJECTION_CACHE_MAX_ENTRIES) {
    const oldest = agentArtifactCache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    agentArtifactCache.delete(oldest);
  }
  return value;
}

function sameAttachments(
  previous: readonly UserMessageAttachment[],
  next: readonly UserMessageAttachment[],
): boolean {
  return (
    previous.length === next.length &&
    previous.every((value, index) => {
      const candidate = next[index];
      return (
        candidate !== undefined &&
        value.kind === candidate.kind &&
        value.name === candidate.name &&
        attachmentSourceKey(value.source) === attachmentSourceKey(candidate.source)
      );
    })
  );
}
