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
  "lost",
  "unknown",
] as const;
const KINDS = ["agent", "command", "other"] as const;
const DELIVERIES = ["wake", "midTurn"] as const;

type TaskNotificationStatus = (typeof STATUSES)[number];

/**
 * A background task's report to the agent: a subagent or background command
 * finished, stopped or reported progress. `wake` reports started a turn
 * nobody asked for; `midTurn` reports arrived while a turn was running.
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
const reportCache = new WeakMap<TurnItem, TaskNotificationReport | null>();
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
    const report = isTaskNotificationItem(item) ? taskNotificationReport(item) : null;
    if (report !== null) {
      (report.delivery === "wake" ? wake : midTurn).push(report);
    }
  }
  const value = wake.length === 0 && midTurn.length === 0 ? EMPTY : { midTurn, wake };
  turnCache.set(turn.items, value);
  return value;
}

function taskNotificationReport(item: TurnItem): TaskNotificationReport | null {
  const cached = reportCache.get(item);
  if (cached !== undefined) {
    return cached;
  }
  const report = parseReport(unknownRecord(item));
  reportCache.set(item, report);
  return report;
}

function parseReport(raw: Record<string, unknown> | null): TaskNotificationReport | null {
  const identity = raw === null ? null : reportIdentity(raw);
  if (raw === null || identity === null) {
    return null;
  }
  return {
    ...identity,
    agentThreadId: nonEmptyString(raw.agentThreadId),
    durationMs: nonNegativeNumber(raw.durationMs),
    name: nonEmptyString(raw.name) ?? "Background task",
    result: nonEmptyString(raw.result),
    status: oneOf(STATUSES, raw.status) ?? "unknown",
    toolUses: nonNegativeNumber(raw.toolUses),
  };
}

/** The fields a report cannot exist without; anything else degrades to unknown. */
function reportIdentity(
  raw: Record<string, unknown>,
): Pick<TaskNotificationReport, "delivery" | "id" | "kind" | "taskId"> | null {
  const id = nonEmptyString(raw.id);
  const taskId = nonEmptyString(raw.taskId);
  const kind = oneOf(KINDS, raw.kind);
  const delivery = oneOf(DELIVERIES, raw.delivery);
  return id === null || taskId === null || kind === null || delivery === null
    ? null
    : { delivery, id, kind, taskId };
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
