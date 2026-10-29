import type { Turn } from "@codewide/codex-protocol/v0.155.1/v2";
import type { BackgroundCommandProjection } from "@codewide/sync-client";
import type { TaskNotificationReport } from "../../../rendering/taskNotifications";
import { turnBackgroundCommands } from "../protocol/backgroundCommand";

/** A shortened command stands in for a launch the agent gave no description. */
const COMMAND_TITLE_MAX_CHARS = 60;
const MS_PER_SECOND = 1000;

/**
 * A command the turn started in the background, drawn as the same pill as a
 * task report: one element per task, whose state follows the command item
 * (`codewideBackgroundTask`) from running to its end.
 */
export type BackgroundLaunchEntry = {
  readonly agentThreadId: null;
  readonly delivery: "midTurn";
  /** The task's whole run once it ended, when both ends are known. */
  readonly durationMs: number | null;
  readonly id: string;
  readonly kind: "command";
  readonly launch: BackgroundCommandProjection;
  readonly name: string;
  readonly result: null;
  readonly status: BackgroundCommandProjection["status"];
  readonly taskId: string;
  readonly toolUses: null;
};

/** One element of a task line: a report delivered to the agent, or a background command. */
export type TaskLineEntry = TaskNotificationReport | BackgroundLaunchEntry;

/** Whether a line entry is a background command rather than a delivered report. */
export function isBackgroundLaunch(entry: TaskLineEntry): entry is BackgroundLaunchEntry {
  return "launch" in entry;
}

const launchCache = new WeakMap<Turn, readonly BackgroundLaunchEntry[]>();
const NO_LAUNCHES: readonly BackgroundLaunchEntry[] = [];

/** The background commands a turn started, in item order, each in its latest state. */
export function turnBackgroundLaunches(turn: Turn): readonly BackgroundLaunchEntry[] {
  const cached = launchCache.get(turn);
  if (cached !== undefined) {
    return cached;
  }
  const commands = new Map(
    turn.items.flatMap((item) =>
      item.type === "commandExecution" ? [[item.id, item.command] as const] : [],
    ),
  );
  const launches = turnBackgroundCommands(turn).map(({ itemId, task }): BackgroundLaunchEntry => ({
    agentThreadId: null,
    delivery: "midTurn",
    durationMs: runDurationMs(task),
    id: itemId,
    kind: "command",
    launch: task,
    name: task.description ?? commandTitle(commands.get(itemId) ?? ""),
    result: null,
    status: task.status,
    taskId: task.taskId,
    toolUses: null,
  }));
  const value = launches.length === 0 ? NO_LAUNCHES : launches;
  launchCache.set(turn, value);
  return value;
}

/** The task ids of every background command `turns` started. */
export function launchedTaskIds(turns: Iterable<Turn>): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const turn of turns) {
    for (const launch of turnBackgroundLaunches(turn)) {
      ids.add(launch.taskId);
    }
  }
  return ids;
}

/**
 * Reports without the command reports of tasks `launched` names: the launch
 * pill already shows that task's end. Agent and other reports stay.
 */
export function withoutLaunchedReports<Entry extends TaskLineEntry>(
  entries: readonly Entry[],
  launched: ReadonlySet<string>,
): readonly Entry[] {
  if (launched.size === 0) {
    return entries;
  }
  const kept = entries.filter(
    (entry) => isBackgroundLaunch(entry) || entry.kind !== "command" || !launched.has(entry.taskId),
  );
  return kept.length === entries.length ? entries : kept;
}

/** How long the task ran, from its start to its end, once both are known. */
function runDurationMs(task: BackgroundCommandProjection): number | null {
  if (task.startedAt === null || !("endedAt" in task)) {
    return null;
  }
  return Math.max(0, task.endedAt - task.startedAt) * MS_PER_SECOND;
}

function commandTitle(command: string): string {
  const line = command.trim().split("\n")[0] ?? "";
  if (line === "") {
    return "Background command";
  }
  return line.length > COMMAND_TITLE_MAX_CHARS
    ? `${line.slice(0, COMMAND_TITLE_MAX_CHARS - 1)}…`
    : line;
}
