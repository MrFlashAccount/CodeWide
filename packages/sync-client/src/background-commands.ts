/**
 * The Companion's background command marker (`codewideBackgroundTask` on a
 * `commandExecution` item): the task the command started and what the
 * provider knows of its process. The Companion republishes the same item of
 * the same turn when the state changes; an ended state is final.
 */

/** Running until it ends; an ended state carries its end (Unix seconds) and, when reported, its exit code. */
export type BackgroundCommandState =
  | { readonly status: "running" }
  | {
      readonly endedAt: number;
      readonly exitCode: number | null;
      readonly status: "completed" | "failed";
    }
  | { readonly endedAt: number; readonly status: "stopped" }
  | { readonly status: "unknown" };

/**
 * The background task a command started and its state: when it started (Unix
 * seconds) and the agent's short description of it, each `null` when the
 * Companion did not say (an older Companion names only the task).
 */
export type BackgroundCommandProjection = BackgroundCommandState & {
  readonly description: string | null;
  readonly startedAt: number | null;
  readonly taskId: string;
};

/** The item field the Companion projects the marker to. */
export const BACKGROUND_COMMAND_FIELD = "codewideBackgroundTask";

/** The marker of a wire value, or `null` when it is not a valid one. */
export function parseBackgroundCommand(value: unknown): BackgroundCommandProjection | null {
  if (typeof value !== "object" || value === null || !("taskId" in value) || !("status" in value)) {
    return null;
  }
  const { taskId } = value;
  if (typeof taskId !== "string" || taskId === "") {
    return null;
  }
  const endedAt = "endedAt" in value && isTime(value.endedAt) ? value.endedAt : null;
  const startedAt = "startedAt" in value && isTime(value.startedAt) ? value.startedAt : null;
  const description =
    "description" in value && typeof value.description === "string" && value.description !== ""
      ? value.description
      : null;
  switch (value.status) {
    case "running":
    case "unknown":
      return { description, startedAt, status: value.status, taskId };
    case "stopped":
      return endedAt === null ? null : { description, endedAt, startedAt, status: "stopped", taskId };
    case "completed":
    case "failed": {
      const exitCode = "exitCode" in value ? exitCodeOf(value.exitCode) : null;
      return endedAt === null || exitCode === undefined
        ? null
        : { description, endedAt, exitCode, startedAt, status: value.status, taskId };
    }
    default:
      return null;
  }
}

/** Whether the process ended (completed, failed or stopped). */
export function backgroundCommandEnded(state: BackgroundCommandState): boolean {
  return state.status === "completed" || state.status === "failed" || state.status === "stopped";
}

/** The state after learning `next`: an ended state never changes again. */
export function advanceBackgroundCommand(
  current: BackgroundCommandProjection | null,
  next: BackgroundCommandProjection,
): BackgroundCommandProjection {
  return current !== null && backgroundCommandEnded(current) ? current : next;
}

/** An exit code, `null` when none was reported, `undefined` when invalid. */
function exitCodeOf(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * The state after an authoritative read answered `read`: the read's end wins
 * (it is what the provider proves now), a read that has not ended never
 * replaces an end the client already has, and otherwise the read wins.
 */
export function reconcileBackgroundCommand(
  local: BackgroundCommandProjection | null,
  read: BackgroundCommandProjection,
): BackgroundCommandProjection {
  if (backgroundCommandEnded(read) || local === null || !backgroundCommandEnded(local)) {
    return read;
  }
  return local;
}
