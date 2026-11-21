import {
  parseBackgroundCommand,
  RpcResponseError,
  type BackgroundCommandProjection,
} from "@codewide/sync-client";

import { unknownRecord } from "./unknownRecord";

/** A host or provider without the list answers this; it has nothing running to show. */
const CAPABILITY_UNSUPPORTED = -32_072;
const METHOD_NOT_FOUND = -32_601;

/**
 * A background command of a thread that still runs, in its provider's model:
 * a `task` the turn's command item launched, with that turn, whose output
 * the background task reader opens; or a `terminal` the provider keeps open
 * for a command item, named by its process.
 */
export type RunningBackgroundTask =
  | {
      readonly command: string;
      readonly itemId: string;
      readonly kind: "task";
      readonly task: BackgroundCommandProjection;
      readonly turnId: string;
    }
  | {
      readonly command: string;
      readonly itemId: string;
      readonly kind: "terminal";
      readonly processId: string;
    };

/** The query key of one thread's running background commands. */
export function runningBackgroundTasksKey(
  connectionId: string,
  threadId: string,
): readonly [string, string, string] {
  return ["thread/backgroundTasks", connectionId, threadId];
}

/**
 * The thread's background commands that still run, as its provider's live
 * session knows them; empty when the host or the thread's provider cannot
 * list them.
 */
export async function listRunningBackgroundTasks(
  call: (method: string, params: unknown) => Promise<unknown>,
  threadId: string,
): Promise<readonly RunningBackgroundTask[]> {
  let response: unknown;
  try {
    response = await call("companion/thread/backgroundTasks/list", { threadId });
  } catch (error) {
    if (
      error instanceof RpcResponseError &&
      (error.code === CAPABILITY_UNSUPPORTED || error.code === METHOD_NOT_FOUND)
    ) {
      return [];
    }
    throw error;
  }
  const tasks = unknownRecord(response)?.tasks;
  if (!Array.isArray(tasks)) {
    throw new Error("The Companion sent an unreadable background task list");
  }
  return tasks.flatMap((value: unknown) => {
    const task = parseRunningTask(unknownRecord(value));
    return task === null ? [] : [task];
  });
}

function parseRunningTask(raw: Record<string, unknown> | null): RunningBackgroundTask | null {
  if (raw === null || typeof raw.command !== "string" || typeof raw.itemId !== "string") {
    return null;
  }
  return raw.kind === "terminal"
    ? parseTerminal(raw, raw.command, raw.itemId)
    : parseTask(raw, raw.command, raw.itemId);
}

function parseTerminal(
  raw: Record<string, unknown>,
  command: string,
  itemId: string,
): RunningBackgroundTask | null {
  return typeof raw.processId === "string"
    ? { command, itemId, kind: "terminal", processId: raw.processId }
    : null;
}

function parseTask(
  raw: Record<string, unknown>,
  command: string,
  itemId: string,
): RunningBackgroundTask | null {
  const task = parseBackgroundCommand(raw.background);
  if (raw.kind !== "task" || task === null || typeof raw.turnId !== "string") {
    return null;
  }
  return { command, itemId, kind: "task", task, turnId: raw.turnId };
}
