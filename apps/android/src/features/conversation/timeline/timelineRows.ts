import { projectCompleteMarkdown } from "@codewide/rendering-core";
import { markdownDocumentBlocks } from "../../../rendering/markdown-document-blocks";
import { groupListParts } from "./chatListParts";
import type { TaskNotificationReport } from "../../../rendering/taskNotifications";
import {
  isBackgroundLaunch,
  launchAwaitsEnd,
  reportedCommandEnd,
  turnBackgroundLaunches,
  withoutLaunchedReports,
  type TaskLineEntry,
} from "../turns/backgroundLaunches";
import { projectTurnPresentation } from "../turns/turnProjection";
import type { VirtualizedTurnPart, VirtualizedTurnPlacement } from "../turns/virtualizedTurnTypes";
import { packMarkdownRows } from "./packMarkdownRows";
import { timelineItemKey } from "./timelineProjection";
import type { TimelineItem } from "./timelineTypes";

export const TIMELINE_ROW_FALLBACK_ESTIMATE = 115;

export type TimelineRow =
  | {
      item: Extract<TimelineItem, { kind: "turn" }>;
      key: string;
      kind: "historyBeginning";
      timelineIndex: number;
    }
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
      /** Background task reports drawn as one line outside the bubble; empty for a person's turn. */
      notifications: readonly TaskNotificationReport[];
      timelineIndex: number;
    }
  | {
      followsLead: boolean;
      item: Extract<TimelineItem, { kind: "turn" }>;
      key: string;
      kind: "turnSlice";
      /** Initial native estimate for neighbouring blocks mounted in one physical row. */
      packedSizeEstimate?: number;
      parts: readonly VirtualizedTurnPart[];
      /** The slice's place within its turn's bubble. */
      placement: VirtualizedTurnPlacement;
      timelineIndex: number;
      /**
       * The task line after the turn's last slice: the reports a person's
       * turn received while it answered and the commands the turn started in
       * the background; empty for other slices.
       */
      trailingTasks: readonly TaskLineEntry[];
    };

type TimelineRowsCacheEntry = {
  key: string;
  rows: TimelineRow[];
};

type TimelineItemRowsCacheEntry = TimelineRowsCacheEntry & {
  timelineIndex: number;
};

type TimelineRowsOptions = {
  containsBeginning?: boolean;
  enabled: boolean;
  nativeLists?: boolean;
  /** The normal viewport packs nearby blocks. Exact per-block measurement uses individual rows. */
  packMarkdown?: boolean;
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
  const showBeginning = options.containsBeginning === true && !options.threadSearchActive;
  const cacheKey = `${timelineRowsOptionsKey(options)}:${String(showBeginning)}`;
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
  const visible = withoutDuplicateTasks(rows);
  const merged = mergeEmptyWakeLeads(visible, showBeginning ? historyBeginningRows(visible) : []);
  timelineRowsCache.set(items, { key: cacheKey, rows: merged });
  return merged;
}

function historyBeginningRows(rows: readonly TimelineRow[]): TimelineRow[] {
  const first = rows.find((row) => row.item.kind === "turn");
  if (first?.item.kind !== "turn") {
    return [];
  }
  return [
    {
      item: first.item,
      key: `history-beginning:${timelineItemKey(first.item)}`,
      kind: "historyBeginning",
      timelineIndex: first.timelineIndex,
    },
  ];
}

type TimelineLeadRow = Extract<TimelineRow, { kind: "turnLead" }>;

/**
 * One element per background task: a command the shown history started is
 * drawn by its launch pill, whose state follows it to its end, so the
 * report of that command (in a later wake or a later answer) is not drawn
 * again. A wake whose only line was such a report draws nothing. Agent and
 * other reports, and reports of commands launched outside the shown range,
 * keep their own line.
 */
function withoutDuplicateTasks(rows: TimelineRow[]): TimelineRow[] {
  const launched = new Set<string>();
  const ends = new Map<string, ReportedEnd>();
  for (const entry of timelineTaskEntries(rows)) {
    if (isBackgroundLaunch(entry)) {
      launched.add(entry.taskId);
    } else if (!("terminal" in entry) && !ends.has(entry.taskId)) {
      const status = reportedCommandEnd(entry);
      if (status !== null) {
        ends.set(entry.taskId, { durationMs: entry.durationMs, status });
      }
    }
  }
  if (launched.size === 0) {
    return rows;
  }
  return rows.flatMap((row): TimelineRow[] => {
    if (row.kind === "turnLead") {
      const notifications = withoutLaunchedReports(row.notifications, launched);
      if (notifications === row.notifications) {
        return [row];
      }
      return notifications.length === 0 && isReportLead(row) ? [] : [{ ...row, notifications }];
    }
    if (row.kind === "turnSlice") {
      const kept = withoutLaunchedReports(row.trailingTasks, launched);
      const trailingTasks = settleReportedLaunches(kept, ends);
      return [trailingTasks === row.trailingTasks ? row : { ...row, trailingTasks }];
    }
    return [row];
  });
}

/** The visible task line of one physical row. */
export function taskLineEntries(row: TimelineRow): readonly TaskLineEntry[] {
  if (row.kind === "turnLead") {
    return row.notifications;
  }
  return row.kind === "turnSlice" ? row.trailingTasks : NO_TASKS;
}

export function* timelineTaskEntries(rows: readonly TimelineRow[]): Iterable<TaskLineEntry> {
  for (const row of rows) {
    yield* taskLineEntries(row);
  }
}

type ReportedEnd = {
  readonly durationMs: number | null;
  readonly status: NonNullable<ReturnType<typeof reportedCommandEnd>>;
};

function settleReportedLaunches(
  entries: readonly TaskLineEntry[],
  ends: ReadonlyMap<string, ReportedEnd>,
): readonly TaskLineEntry[] {
  if (ends.size === 0) {
    return entries;
  }
  let settled: TaskLineEntry[] | undefined;
  for (const [index, entry] of entries.entries()) {
    const report = ends.get(entry.taskId);
    if (report !== undefined && isBackgroundLaunch(entry) && launchAwaitsEnd(entry)) {
      settled ??= entries.slice();
      settled[index] = { ...entry, durationMs: report.durationMs, status: report.status };
    }
  }
  return settled ?? entries;
}

type TimelineTurnItem = Extract<TimelineItem, { kind: "turn" }>;

/**
 * Wakes that produced nothing draw only their reason line. Consecutive ones
 * (several background tasks finishing at once) read as one line, joined with
 * the next wake's line when that one answers. Only lines merge; no turn
 * content moves between turns.
 */
function mergeEmptyWakeLeads(rows: readonly TimelineRow[], merged: TimelineRow[]): TimelineRow[] {
  let pending: TimelineLeadRow | null = null;
  for (const [index, row] of rows.entries()) {
    const current = joinPendingLine(merged, pending, row);
    pending = isReportLead(current) && rows[index + 1]?.item !== row.item ? current : null;
    if (pending === null) {
      merged.push(current);
    }
  }
  if (pending !== null) {
    merged.push(pending);
  }
  return merged;
}

/** Prepends a held line to the next reason line, or emits it before any other row. */
function joinPendingLine(
  merged: TimelineRow[],
  pending: TimelineLeadRow | null,
  row: TimelineRow,
): TimelineRow {
  if (pending === null) {
    return row;
  }
  if (isReportLead(row)) {
    // The line keeps its first wake's row: its key, date and place stay put
    // while later wakes join it.
    return { ...pending, notifications: [...pending.notifications, ...row.notifications] };
  }
  merged.push(pending);
  return row;
}

/** A lead row that draws only report lines; one with a person's message or a compaction keeps its turn. */
export function isReportLead(row: TimelineRow): row is TimelineLeadRow {
  return (
    row.kind === "turnLead" &&
    row.notifications.length > 0 &&
    !hasTurnLead(projectTurnPresentation(row.item, null, false, false))
  );
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
  const notifications = leadNotifications(presentation);
  const lead: TimelineLeadRow = {
    item,
    key: `${timelineItemKey(item)}\u0000lead`,
    kind: "turnLead",
    notifications,
    timelineIndex,
  };
  const leadOnly = leadOnlyRows(presentation, lead);
  if (leadOnly !== null) {
    return leadOnly;
  }
  const followsLead = hasTurnLead(presentation) || notifications.length > 0;
  const slices = turnSlices({ followsLead, item, options, presentation, timelineIndex });
  return followsLead ? [lead, ...slices] : slices;
}

/**
 * A turn without a response draws no bubble: a wake that produced nothing
 * only its reason line (if any), a turn that only compacted the context only
 * its lifecycle lines. `null` for a turn with a response.
 */
function leadOnlyRows(
  presentation: ReturnType<typeof projectTurnPresentation>,
  lead: TimelineLeadRow,
): TimelineRow[] | null {
  if (presentation.isEmptyWake) {
    return lead.notifications.length === 0 ? [] : [lead];
  }
  return presentation.isCompactionOnly ? [lead] : null;
}

function turnSlices({
  followsLead,
  item,
  options,
  presentation,
  timelineIndex,
}: {
  followsLead: boolean;
  item: TimelineTurnItem;
  options: TimelineRowsOptions;
  presentation: ReturnType<typeof projectTurnPresentation>;
  timelineIndex: number;
}): TimelineRow[] {
  const parts = projectTurnParts(presentation);
  const slices = turnPartSlices(parts, options, presentation);
  const baseKey = timelineItemKey(item);
  const trailing = trailingTasks(presentation);
  return slices.map((slice, index) => ({
    followsLead,
    item,
    key: index === 0 ? baseKey : `${baseKey}\u0000slice:${virtualizedPartKey(slice[0])}`,
    kind: "turnSlice" as const,
    ...(slice !== parts && slice.length > 1
      ? { packedSizeEstimate: slice.length * timelineRowSizeEstimate() }
      : {}),
    parts: slice,
    placement: slicePlacement(index, slices.length),
    timelineIndex,
    trailingTasks: index === slices.length - 1 ? trailing : NO_TASKS,
  }));
}

const NO_TASKS: readonly TaskLineEntry[] = [];

/**
 * The line after a turn's bubble: a person's turn's mid-turn reports (a
 * wake turn lists them on its reason line instead), then the commands the
 * turn started in the background.
 */
function trailingTasks(
  presentation: ReturnType<typeof projectTurnPresentation>,
): readonly TaskLineEntry[] {
  const midTurn =
    presentation.userBlocks.length > 0 ? presentation.taskNotifications.midTurn : NO_TASKS;
  const launches = turnBackgroundLaunches(presentation.rawTurn);
  if (launches.length === 0) {
    return midTurn;
  }
  return midTurn.length === 0 ? launches : [...midTurn, ...launches];
}

function timelineRowsOptionsKey(options: TimelineRowsOptions): string {
  return `${String(options.enabled)}:${String(options.packMarkdown === true)}:${String(options.nativeLists === true)}:${String(options.threadSearchActive)}:${options.searchMessageItemId ?? ""}`;
}

/**
 * The reports a wake turn draws before its bubble: those that woke it and
 * those that arrived while it answered. A person's turn draws its mid-turn
 * reports after its bubble instead.
 */
function leadNotifications(
  presentation: ReturnType<typeof projectTurnPresentation>,
): readonly TaskNotificationReport[] {
  const { midTurn, wake } = presentation.taskNotifications;
  if (presentation.userBlocks.length > 0 || (wake.length === 0 && midTurn.length === 0)) {
    return [];
  }
  return midTurn.length === 0 ? wake : [...wake, ...midTurn];
}

function hasTurnLead(presentation: ReturnType<typeof projectTurnPresentation>): boolean {
  return presentation.userBlocks.length > 0 || presentation.leadCompactionBlocks.length > 0;
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

function turnPartSlices(
  parts: VirtualizedTurnPart[],
  options: TimelineRowsOptions,
  presentation: ReturnType<typeof projectTurnPresentation>,
): VirtualizedTurnPart[][] {
  if (
    presentation.rawTurn.status === "inProgress" ||
    options.threadSearchActive ||
    !parts.every((part) => part.kind === "markdownBlock")
  ) {
    return [parts];
  }
  const grouped = options.nativeLists === true ? groupListParts(parts) : parts;
  return presentation.agentBubbleFill || grouped !== parts
    ? packMarkdownRows(grouped, options.packMarkdown === true)
    : [parts];
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
