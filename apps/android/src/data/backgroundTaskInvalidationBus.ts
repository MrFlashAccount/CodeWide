import { BACKGROUND_COMMAND_FIELD } from "@codewide/sync-client";

import { unknownRecord } from "./unknownRecord";

/** The client-wire item type of a background task report. */
const TASK_NOTIFICATION_ITEM = "codewideTaskNotification";
/** The client-wire item type of a command. */
const COMMAND_ITEM = "commandExecution";

type Listener = (connectionId: string, threadId: string) => void;

const listeners = new Set<Listener>();

/**
 * Whether a wire item launches a background command or reports one: a
 * background task item, its report, or a command that keeps a provider
 * terminal open (its process).
 */
function touchesBackgroundTasks(item: unknown): boolean {
  const record = unknownRecord(item);
  return (
    record !== null &&
    (record[BACKGROUND_COMMAND_FIELD] !== undefined ||
      record.type === TASK_NOTIFICATION_ITEM ||
      (record.type === COMMAND_ITEM && typeof record.processId === "string"))
  );
}

/**
 * The thread whose running background commands an ordered event may change:
 * an item that launches one, changes its state or reports it, alone or
 * inside a turn; `null` for every other event.
 */
function changedThread(params: unknown): string | null {
  const record = unknownRecord(params);
  if (record === null || typeof record.threadId !== "string") {
    return null;
  }
  const items = unknownRecord(record.turn)?.items;
  const touched =
    touchesBackgroundTasks(record.item) ||
    (Array.isArray(items) && items.some((item: unknown) => touchesBackgroundTasks(item)));
  return touched ? record.threadId : null;
}

/**
 * Routes "a thread's running background commands may have changed" from the
 * ordered event projection to the resource owner that re-reads the list.
 * Content-free: only the thread id passes through here.
 */
export const backgroundTaskInvalidationBus = {
  /** A command of `threadId` ended outside its event stream (a terminal the user stopped). */
  changed(connectionId: string, threadId: string): void {
    for (const listener of listeners) {
      listener(connectionId, threadId);
    }
  },
  publish(connectionId: string, params: unknown): void {
    const threadId = changedThread(params);
    if (threadId !== null) {
      backgroundTaskInvalidationBus.changed(connectionId, threadId);
    }
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
