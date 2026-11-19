import type { RunningBackgroundTask } from "../../../data/runningBackgroundTasks";
import {
  backgroundLaunchEntry,
  isBackgroundLaunch,
  launchAwaitsEnd,
  reportedCommandEnd,
  terminalLineEntry,
  type TaskLineEntry,
} from "../turns/backgroundLaunches";
import {
  isReportLead,
  taskLineEntries,
  timelineTaskEntries,
  type TimelineRow,
} from "./timelineRows";

const EMPTY: readonly TaskLineEntry[] = [];

export type TimelineTaskPlacement = {
  readonly footer: readonly TaskLineEntry[];
  readonly rows: TimelineRow[];
};

/** A live command has one owner at the footer until its final history entry takes over. */
export function placeRunningTasks(
  rows: TimelineRow[],
  running: readonly RunningBackgroundTask[],
  atLatest: boolean,
): TimelineTaskPlacement {
  if (running.length === 0) {
    return { footer: EMPTY, rows };
  }
  const live = liveEntries(rows, running);
  if (live.size === 0) {
    return { footer: EMPTY, rows };
  }

  // Include the adjacent historical line in the same picker when the real conversation tail is shown.
  const last = atLatest ? rows.at(-1) : undefined;
  const tail = adjacentEntries(last);
  const footer = new Map<string, TaskLineEntry>();
  for (const entry of tail) {
    footer.set(taskIdentity(entry), entry);
  }
  for (const [id, entry] of live) {
    footer.set(id, entry);
  }

  return {
    footer: [...footer.values()],
    rows: historyWithoutLiveTasks(rows, tail.length > 0 ? last : undefined, live),
  };
}

function historyWithoutLiveTasks(
  rows: TimelineRow[],
  movedTail: TimelineRow | undefined,
  live: ReadonlyMap<string, TaskLineEntry>,
): TimelineRow[] {
  let visible: TimelineRow[] | undefined;
  for (const [index, row] of rows.entries()) {
    const updated = historyRow(row, row === movedTail, live);
    if (updated !== row) {
      visible ??= rows.slice();
      visible[index] = updated;
    }
  }
  return visible ?? rows;
}

function adjacentEntries(row: TimelineRow | undefined): readonly TaskLineEntry[] {
  return row !== undefined && (row.kind === "turnSlice" || isReportLead(row))
    ? taskLineEntries(row)
    : EMPTY;
}

function liveEntries(
  rows: readonly TimelineRow[],
  running: readonly RunningBackgroundTask[],
): Map<string, TaskLineEntry> {
  const live = new Map<string, TaskLineEntry>();
  for (const task of running) {
    const entry =
      task.kind === "terminal"
        ? terminalLineEntry(task)
        : backgroundLaunchEntry(task.itemId, task.command, task.task);
    live.set(taskIdentity(entry), entry);
  }
  for (const entry of timelineTaskEntries(rows)) {
    if (commandHasEnded(entry)) {
      live.delete(taskIdentity(entry));
    }
  }
  return live;
}

function historyRow(
  row: TimelineRow,
  movedTail: boolean,
  live: ReadonlyMap<string, TaskLineEntry>,
): TimelineRow {
  if (row.kind === "turnLead" && movedTail) {
    return { ...row, notifications: [] };
  }
  if (row.kind !== "turnSlice" || row.trailingTasks.length === 0) {
    return row;
  }
  if (movedTail) {
    return { ...row, trailingTasks: EMPTY };
  }
  const kept = row.trailingTasks.filter(
    (entry) => !isBackgroundLaunch(entry) || !live.has(taskIdentity(entry)),
  );
  return kept.length === row.trailingTasks.length ? row : { ...row, trailingTasks: kept };
}

function commandHasEnded(entry: TaskLineEntry): boolean {
  if (isBackgroundLaunch(entry)) {
    return !launchAwaitsEnd(entry);
  }
  return !("terminal" in entry) && reportedCommandEnd(entry) !== null;
}

/** Reports have their own identity; only a command and its live listing share a task id. */
function taskIdentity(entry: TaskLineEntry): string {
  if ("terminal" in entry) {
    return JSON.stringify(["terminal", entry.terminal.itemId, entry.terminal.processId]);
  }
  return entry.kind === "command" ? `command:${entry.taskId}` : `report:${entry.id}`;
}
