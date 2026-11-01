import type { Turn } from "@codewide/codex-protocol/v0.155.1/v2";
import {
  BACKGROUND_COMMAND_FIELD,
  parseBackgroundCommand,
  projectedTurnMetadata,
  reconcileBackgroundCommand,
  type BackgroundCommandProjection,
} from "@codewide/sync-client";

/**
 * The output screen's title from a command block, which knows no task name;
 * the command itself shows on the screen's prompt line.
 */
export const BACKGROUND_COMMAND_NAME = "Background command";

/**
 * The background task a command item started (`codewideBackgroundTask`), else
 * `null` for a foreground command. An older Companion names only the task
 * (`codewideBackgroundTaskId`), whose state is then unknown.
 */
export function commandBackgroundTask(
  raw: Readonly<Record<string, unknown>>,
): BackgroundCommandProjection | null {
  const marker = parseBackgroundCommand(raw[BACKGROUND_COMMAND_FIELD]);
  if (marker !== null) {
    return marker;
  }
  const legacyId = raw.codewideBackgroundTaskId;
  return typeof legacyId === "string" && legacyId !== ""
    ? { description: null, startedAt: null, status: "unknown", taskId: legacyId }
    : null;
}

/** A background command of a turn: the command item's id and its task. */
export type TurnBackgroundCommand = {
  readonly itemId: string;
  readonly task: BackgroundCommandProjection;
};

/**
 * The background commands a turn started, in item order, each in its latest
 * state: the state the turn's mutable metadata keeps (every live event and
 * read reconciles it there, since a sealed turn's items do not change), with
 * the item's own state only where the metadata knows none or has not ended
 * while the item has.
 */
export function turnBackgroundCommands(turn: Turn): TurnBackgroundCommand[] {
  const latest = projectedTurnMetadata(turn)?.backgroundCommands;
  return turn.items.flatMap((item) => {
    if (item.type !== "commandExecution") {
      return [];
    }
    const own = commandBackgroundTask(item);
    const known = parseBackgroundCommand(latest?.[item.id]);
    const task =
      own === null ? known : known === null ? own : reconcileBackgroundCommand(own, known);
    return task === null ? [] : [{ itemId: item.id, task }];
  });
}
