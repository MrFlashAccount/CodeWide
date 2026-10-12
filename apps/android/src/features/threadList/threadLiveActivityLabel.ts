import type { LiveActivity } from "@codewide/sync-client";

/**
 * The thread row's one-line description of a running thread's current work,
 * or `null` for a mechanical step (a command, file edit, tool call, search or
 * compaction) that the row leaves to the preview.
 */
export function threadLiveActivityLabel(activity: LiveActivity): string | null {
  switch (activity.kind) {
    case "reasoning":
      return activity.title;
    case "planStep":
      return activity.step;
    case "command":
    case "fileEdit":
    case "tool":
    case "webSearch":
    case "compacting":
      return null;
    default:
      return unreachableActivity(activity);
  }
}

function unreachableActivity(activity: never): never {
  throw new Error(`Unhandled live activity: ${JSON.stringify(activity)}`);
}
