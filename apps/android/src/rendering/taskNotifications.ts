import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import { unknownRecord } from "../data/unknownRecord";

type Turn = Thread["turns"][number];
type TurnItem = Turn["items"][number];

/** The Codex-shaped item type the Companion uses for a background task report. */
const TASK_NOTIFICATION_ITEM_TYPE = "codewideTaskNotification";

const STATUSES = [
  "completed",
  "failed",
  "killed",
  "stopped",
  "interim",
  "interrupted",
  "lost",
  "unknown",
] as const;
const KINDS = ["agent", "command", "other"] as const;
const DELIVERIES = ["wake", "midTurn"] as const;

type TaskNotificationStatus = (typeof STATUSES)[number];

/**
 * A background task's report to the agent: a subagent or background command
 * finished, stopped, was interrupted or reported progress. `wake` reports
 * started a turn nobody asked for; `midTurn` reports arrived while a turn was
 * running.
 */
export type TaskNotificationReport = {
  /** The subagent's thread, for navigation; `null` for commands and unknown agents. */
  readonly agentThreadId: string | null;
  readonly delivery: (typeof DELIVERIES)[number];
  readonly durationMs: number | null;
  readonly id: string;
  readonly kind: (typeof KINDS)[number];
  readonly name: string;
  readonly result: string | null;
  readonly status: TaskNotificationStatus;
  readonly taskId: string;
  readonly toolUses: number | null;
};

/** The reports of one turn, split by how they were delivered. */
export type TurnTaskNotifications = {
  readonly midTurn: readonly TaskNotificationReport[];
  readonly wake: readonly TaskNotificationReport[];
};

const EMPTY: TurnTaskNotifications = { midTurn: [], wake: [] };
const NO_REPORTS: readonly TaskNotificationReport[] = [];
const reportCache = new WeakMap<TurnItem, readonly TaskNotificationReport[]>();
const turnCache = new WeakMap<Turn["items"], TurnTaskNotifications>();

/** Whether a turn item is a background task report rather than turn activity. */
export function isTaskNotificationItem(item: TurnItem): boolean {
  // The generated item union does not list Companion extensions.
  const type: string = item.type;
  return type === TASK_NOTIFICATION_ITEM_TYPE;
}

/** The validated reports of a turn, in delivery order. */
export function turnTaskNotifications(turn: Turn): TurnTaskNotifications {
  const cached = turnCache.get(turn.items);
  if (cached !== undefined) {
    return cached;
  }
  const wake: TaskNotificationReport[] = [];
  const midTurn: TaskNotificationReport[] = [];
  for (const item of turn.items) {
    if (!isTaskNotificationItem(item)) {
      continue;
    }
    for (const report of itemReports(item)) {
      (report.delivery === "wake" ? wake : midTurn).push(report);
    }
  }
  const value = wake.length === 0 && midTurn.length === 0 ? EMPTY : { midTurn, wake };
  turnCache.set(turn.items, value);
  return value;
}

function itemReports(item: TurnItem): readonly TaskNotificationReport[] {
  const cached = reportCache.get(item);
  if (cached !== undefined) {
    return cached;
  }
  const raw = unknownRecord(item);
  const reports = raw === null ? NO_REPORTS : parseItem(raw);
  reportCache.set(item, reports);
  return reports;
}

/**
 * One notice item carries either one report or, as a batch, several in
 * `reports`. A batch's top-level fields only summarise it for older apps, so
 * its valid entries replace them; a batch without one valid entry degrades to
 * that summary.
 */
function parseItem(raw: Record<string, unknown>): readonly TaskNotificationReport[] {
  const kind = oneOf(KINDS, raw.kind);
  const delivery = oneOf(DELIVERIES, raw.delivery);
  if (kind === null || delivery === null) {
    return NO_REPORTS;
  }
  const batch = Array.isArray(raw.reports) ? batchReports(raw.reports, delivery, kind) : NO_REPORTS;
  if (batch.length > 0) {
    return batch;
  }
  const single = singleReport(raw, delivery, kind);
  return single === null ? NO_REPORTS : [single];
}

function singleReport(
  raw: Record<string, unknown>,
  delivery: TaskNotificationReport["delivery"],
  kind: TaskNotificationReport["kind"],
): TaskNotificationReport | null {
  const id = nonEmptyString(raw.id);
  const taskId = nonEmptyString(raw.taskId);
  if (id === null || taskId === null) {
    return null;
  }
  // Both wire shapes build their reports with one property order.
  return {
    agentThreadId: nonEmptyString(raw.agentThreadId),
    delivery,
    durationMs: nonNegativeNumber(raw.durationMs),
    id,
    kind,
    name: nonEmptyString(raw.name) ?? "Background task",
    result: nonEmptyString(raw.result),
    status: oneOf(STATUSES, raw.status) ?? "unknown",
    taskId,
    toolUses: nonNegativeNumber(raw.toolUses),
  };
}

/** A batch's entries share the item's delivery and kind; invalid and repeated ones are skipped. */
function batchReports(
  entries: readonly unknown[],
  delivery: TaskNotificationReport["delivery"],
  kind: TaskNotificationReport["kind"],
): TaskNotificationReport[] {
  const reports: TaskNotificationReport[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    const report = batchEntry(unknownRecord(entry), delivery, kind);
    // Entry ids key rendered rows: a repeated one cannot be told apart.
    if (report !== null && !ids.has(report.id)) {
      ids.add(report.id);
      reports.push(report);
    }
  }
  return reports;
}

/** One batch entry carries no totals or result of its own. */
function batchEntry(
  raw: Record<string, unknown> | null,
  delivery: TaskNotificationReport["delivery"],
  kind: TaskNotificationReport["kind"],
): TaskNotificationReport | null {
  const id = raw === null ? null : nonEmptyString(raw.id);
  const taskId = raw === null ? null : nonEmptyString(raw.taskId);
  if (raw === null || id === null || taskId === null) {
    return null;
  }
  return {
    agentThreadId: nonEmptyString(raw.agentThreadId),
    delivery,
    durationMs: null,
    id,
    kind,
    name: nonEmptyString(raw.name) ?? "Background task",
    result: null,
    status: oneOf(STATUSES, raw.status) ?? "unknown",
    taskId,
    toolUses: null,
  };
}

function oneOf<const Values extends readonly string[]>(
  values: Values,
  value: unknown,
): Values[number] | null {
  return values.find((candidate) => candidate === value) ?? null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
