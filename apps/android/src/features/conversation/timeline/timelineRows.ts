import { projectCompleteMarkdown } from "@codewide/rendering-core";
import { markdownDocumentBlocks } from "../../../rendering/markdown-document-blocks";
import { projectTurnPresentation } from "../turns/turnProjection";
import type { VirtualizedTurnPart, VirtualizedTurnPlacement } from "../turns/virtualizedTurnTypes";
import { timelineItemKey } from "./timelineProjection";
import type { TimelineItem } from "./timelineTypes";

const TIMELINE_ITEM_ESTIMATE = 480;
const MARKDOWN_BLOCK_ESTIMATE = 180;

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
      followsLead: boolean;
      item: Extract<TimelineItem, { kind: "turn" }>;
      key: string;
      kind: "turnSlice";
      parts: readonly VirtualizedTurnPart[];
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
  timelineRowsCache.set(items, { key: cacheKey, rows });
  return rows;
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
      followsLead,
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

export function timelineRowSizeEstimate(rows: readonly TimelineRow[]): number {
  if (rows.length === 0) {
    return TIMELINE_ITEM_ESTIMATE;
  }
  let blockSlices = 0;
  for (const row of rows) {
    if (
      row.kind === "turnSlice" &&
      row.parts.length === 1 &&
      row.parts[0]?.kind === "markdownBlock"
    ) {
      blockSlices += 1;
    }
  }
  const itemCount = rows.length - blockSlices;
  return Math.round(
    (blockSlices * MARKDOWN_BLOCK_ESTIMATE + itemCount * TIMELINE_ITEM_ESTIMATE) / rows.length,
  );
}
