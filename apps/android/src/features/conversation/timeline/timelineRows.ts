import { projectCompleteMarkdown } from "@codewide/rendering-core";
import { markdownDocumentBlocks } from "../../../rendering/markdown-document-blocks";
import { foldsAnswerIntoHistory, type TurnBubbleGroup } from "../turns/turnBubbleGroup";
import { projectTurnPresentation } from "../turns/turnProjection";
import type { VirtualizedTurnPart, VirtualizedTurnPlacement } from "../turns/virtualizedTurnTypes";
import { timelineItemKey } from "./timelineProjection";
import type { TimelineItem } from "./timelineTypes";

export const TIMELINE_ROW_FALLBACK_ESTIMATE = 115;

export type TimelineRow =
  | {
      item: TimelineItem;
      key: string;
      kind: "item";
      timelineIndex: number;
    }
  | {
      item: Extract<TimelineItem, { kind: "turn" }>;
      key: string;
      kind: "turnLead";
      timelineIndex: number;
    }
  | {
      /** The slice's place in its response bubble; differs from `placement` only in a group. */
      bubble: VirtualizedTurnPlacement;
      followsLead: boolean;
      /** The turns drawn as this bubble, or `null` for a turn drawn alone. */
      group: TurnBubbleGroup | null;
      item: Extract<TimelineItem, { kind: "turn" }>;
      key: string;
      kind: "turnSlice";
      parts: readonly VirtualizedTurnPart[];
      /** The slice's place within its own turn. */
      placement: VirtualizedTurnPlacement;
      timelineIndex: number;
    };

type TimelineRowsCacheEntry = {
  key: string;
  rows: TimelineRow[];
};

type TimelineItemRowsCacheEntry = TimelineRowsCacheEntry & {
  timelineIndex: number;
};

type TimelineRowsOptions = {
  enabled: boolean;
  searchMessageItemId: string | null;
  threadSearchActive: boolean;
};

const timelineRowsCache = new WeakMap<readonly TimelineItem[], TimelineRowsCacheEntry>();
const timelineItemRowsCache = new WeakMap<TimelineItem, TimelineItemRowsCacheEntry>();

/** Projects every V1 turn through one block/activity slice model when the feature is enabled. */
export function projectTimelineRows(
  items: readonly TimelineItem[],
  options: TimelineRowsOptions,
): TimelineRow[] {
  const cacheKey = timelineRowsOptionsKey(options);
  const cached = timelineRowsCache.get(items);
  if (cached?.key === cacheKey) {
    return cached.rows;
  }
  const rows: TimelineRow[] = [];
  for (let timelineIndex = 0; timelineIndex < items.length; timelineIndex += 1) {
    const item = items[timelineIndex];
    if (item !== undefined) {
      rows.push(...projectTimelineItemRows(item, timelineIndex, options));
    }
  }
  const grouped = groupContinuedResponses(items, rows);
  timelineRowsCache.set(items, { key: cacheKey, rows: grouped });
  return grouped;
}

type TimelineTurnItem = Extract<TimelineItem, { kind: "turn" }>;

/** A head slice whose answer moved into the bubble's history keeps only that history. */
const FOLDED_PARTS: readonly VirtualizedTurnPart[] = [{ kind: "empty" }];

/**
 * Draws everything from one user message to the next as one agent bubble:
 * a turn without a user message (a background task waking the agent)
 * continues the previous turn's bubble. The bubble reads like one turn: one
 * collapsed history, then the latest answer. Earlier answers fold into that history once the latest turn has
 * finished; the head keeps one slice for it. Row keys and per-turn
 * placement stay as projected, so a live continuation streams into the
 * existing bubble; rows outside a group keep their cached identity.
 */
function groupContinuedResponses(
  items: readonly TimelineItem[],
  rows: TimelineRow[],
): TimelineRow[] {
  const groups = continuedResponseGroups(items, rows);
  if (groups.size === 0) {
    return rows;
  }
  const kept = rows.flatMap((row) => {
    const members = row.kind === "turnSlice" ? groups.get(row.item) : undefined;
    if (row.kind !== "turnSlice" || members === undefined) {
      return [row];
    }
    if (!foldsAnswerIntoHistory(members, row.item)) {
      return [row];
    }
    return row.item === members[0] && isLeadingSlice(row.placement)
      ? [{ ...row, parts: FOLDED_PARTS, placement: "single" as const }]
      : [];
  });
  const groupSlices = new Map<readonly TimelineTurnItem[], number>();
  for (const row of kept) {
    const members = row.kind === "turnSlice" ? groups.get(row.item) : undefined;
    if (members !== undefined) {
      groupSlices.set(members, (groupSlices.get(members) ?? 0) + 1);
    }
  }
  const seen = new Map<readonly TimelineTurnItem[], number>();
  return kept.map((row) => {
    const members = row.kind === "turnSlice" ? groups.get(row.item) : undefined;
    if (row.kind !== "turnSlice" || members === undefined) {
      return row;
    }
    const index = seen.get(members) ?? 0;
    seen.set(members, index + 1);
    return {
      ...row,
      bubble: slicePlacement(index, groupSlices.get(members) ?? 1),
      group: { memberIndex: members.indexOf(row.item), members },
    };
  });
}

/** The agent bubble ends only at a user message: a turn without one continues it. */
function hasUserMessage(item: TimelineTurnItem): boolean {
  return item.turn.items.some((turnItem) => turnItem.type === "userMessage");
}

function isLeadingSlice(placement: VirtualizedTurnPlacement): boolean {
  return placement === "single" || placement === "start";
}

function continuedResponseGroups(
  items: readonly TimelineItem[],
  rows: readonly TimelineRow[],
): Map<TimelineItem, readonly TimelineTurnItem[]> {
  const withLead = new Set(rows.flatMap((row) => (row.kind === "turnLead" ? [row.item] : [])));
  const groups = new Map<TimelineItem, readonly TimelineTurnItem[]>();
  let current: TimelineTurnItem[] = [];
  const close = () => {
    if (current.length > 1) {
      for (const member of current) {
        groups.set(member, current);
      }
    }
  };
  for (const item of items) {
    if (item.kind !== "turn") {
      close();
      current = [];
    } else if (current.length > 0 && !withLead.has(item) && !hasUserMessage(item)) {
      current.push(item);
    } else {
      close();
      current = [item];
    }
  }
  close();
  return groups;
}

function projectTimelineItemRows(
  item: TimelineItem,
  timelineIndex: number,
  options: TimelineRowsOptions,
): TimelineRow[] {
  const cacheKey = timelineRowsOptionsKey(options);
  const cached = timelineItemRowsCache.get(item);
  if (cached?.key === cacheKey && cached.timelineIndex === timelineIndex) {
    return cached.rows;
  }
  const rows = createTimelineItemRows(item, timelineIndex, options);
  timelineItemRowsCache.set(item, { key: cacheKey, rows, timelineIndex });
  return rows;
}

function createTimelineItemRows(
  item: TimelineItem,
  timelineIndex: number,
  options: TimelineRowsOptions,
): TimelineRow[] {
  if (!options.enabled || item.kind !== "turn") {
    return [{ item, key: timelineItemKey(item), kind: "item", timelineIndex }];
  }
  const searchFocus =
    options.searchMessageItemId === null ? null : { itemId: options.searchMessageItemId };
  const presentation = projectTurnPresentation(item, searchFocus, false, false);
  const parts = projectTurnParts(presentation);
  const split = shouldSplitTurn({ options, parts, presentation });
  const slices = split ? parts.map((part) => [part]) : [parts];
  const baseKey = timelineItemKey(item);
  const followsLead = hasTurnLead(presentation);
  return [
    ...(followsLead
      ? [{ item, key: `${baseKey}\u0000lead`, kind: "turnLead" as const, timelineIndex }]
      : []),
    ...slices.map((slice, index) => ({
      bubble: slicePlacement(index, slices.length),
      followsLead,
      group: null,
      item,
      key: index === 0 ? baseKey : `${baseKey}\u0000slice:${virtualizedPartKey(slice[0])}`,
      kind: "turnSlice" as const,
      parts: slice,
      placement: slicePlacement(index, slices.length),
      timelineIndex,
    })),
  ];
}

function timelineRowsOptionsKey(options: TimelineRowsOptions): string {
  return `${String(options.enabled)}:${String(options.threadSearchActive)}:${options.searchMessageItemId ?? ""}`;
}

function hasTurnLead(presentation: ReturnType<typeof projectTurnPresentation>): boolean {
  return presentation.userBlocks.length > 0 || presentation.compactionBlocks.length > 0;
}

function projectTurnParts(
  presentation: ReturnType<typeof projectTurnPresentation>,
): VirtualizedTurnPart[] {
  const parts: VirtualizedTurnPart[] = [];
  if (presentation.rawTurn.status === "inProgress") {
    for (const sequencePart of presentation.visibleLiveActivitySequence) {
      if (sequencePart.kind === "agent") {
        parts.push(...markdownParts(sequencePart.block, true));
      } else {
        parts.push({ kind: "activity", part: sequencePart });
      }
    }
  } else {
    if (presentation.searchedAgentBlock !== null) {
      parts.push(...responseParts(presentation.searchedAgentBlock));
    }
    if (presentation.latestAgentBlock !== null && presentation.hasGeneratedAgentResponse) {
      parts.push(...responseParts(presentation.latestAgentBlock));
    }
  }
  return parts.length === 0 ? [{ kind: "empty" }] : parts;
}

function responseParts(
  response: NonNullable<ReturnType<typeof projectTurnPresentation>["latestAgentBlock"]>,
): VirtualizedTurnPart[] {
  if (response.content?.fields["/text"] !== undefined) {
    return [{ kind: "externalMarkdown", response }];
  }
  return markdownParts(response, false);
}

function markdownParts(
  response: NonNullable<ReturnType<typeof projectTurnPresentation>["latestAgentBlock"]>,
  streaming: boolean,
): VirtualizedTurnPart[] {
  const source = response.body ?? "";
  const blocks = markdownDocumentBlocks(streaming ? [source] : projectCompleteMarkdown(source));
  return blocks.map((block) => ({ block, kind: "markdownBlock", response, streaming }));
}

function shouldSplitTurn({
  options,
  parts,
  presentation,
}: {
  options: TimelineRowsOptions;
  parts: readonly VirtualizedTurnPart[];
  presentation: ReturnType<typeof projectTurnPresentation>;
}): boolean {
  return (
    presentation.rawTurn.status !== "inProgress" &&
    presentation.agentBubbleFill &&
    !options.threadSearchActive &&
    parts.every((part) => part.kind === "markdownBlock")
  );
}

function slicePlacement(index: number, length: number): VirtualizedTurnPlacement {
  if (length === 1) {
    return "single";
  }
  return index === 0 ? "start" : index === length - 1 ? "end" : "middle";
}

function virtualizedPartKey(part: VirtualizedTurnPart | undefined): string {
  if (part === undefined || part.kind === "empty") {
    return "empty";
  }
  if (part.kind === "activity") {
    return part.part.key;
  }
  if (part.kind === "externalMarkdown") {
    return part.response.key;
  }
  return `${part.response.key}:${part.block.key}`;
}

export function timelineRowItem(row: TimelineRow): TimelineItem {
  return row.item;
}

export function timelineRowKey(row: TimelineRow): string {
  return row.key;
}

/** Resolves the first physical agent row for semantic unread/completion positioning. */
export function timelineResponseStartRow(
  rows: readonly TimelineRow[],
  turnId: string,
): { readonly index: number; readonly key: string } | null {
  const index = rows.findIndex(
    (row) =>
      row.kind === "turnSlice" &&
      row.item.id === turnId &&
      (row.placement === "single" || row.placement === "start"),
  );
  const row = rows[index];
  return index < 0 || row === undefined ? null : { index, key: row.key };
}

export function timelineRowSizeEstimate(): number {
  return TIMELINE_ROW_FALLBACK_ESTIMATE;
}
