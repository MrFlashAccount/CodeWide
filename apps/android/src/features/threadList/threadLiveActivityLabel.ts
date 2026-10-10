import type { LiveActivity } from "@codewide/sync-client";

/** The thread row's one-line description of a running thread's current work. */
export function threadLiveActivityLabel(activity: LiveActivity): string {
  switch (activity.kind) {
    case "reasoning":
      return activity.title;
    case "planStep":
      return activity.step;
    case "command":
      return `Running ${activity.command}`;
    case "fileEdit":
      return activity.more > 0
        ? `Editing ${fileName(activity.path)} (+${String(activity.more)})`
        : `Editing ${fileName(activity.path)}`;
    case "tool":
      return activity.server === null
        ? `Using ${activity.tool}`
        : `Using ${activity.tool} (${activity.server})`;
    case "webSearch":
      return "Searching the web";
    case "compacting":
      return "Compacting context";
    default:
      return unreachableActivity(activity);
  }
}

function unreachableActivity(activity: never): never {
  throw new Error(`Unhandled live activity: ${JSON.stringify(activity)}`);
}

function fileName(path: string): string {
  return (
    path
      .split(/[\\/]/u)
      .filter((part) => part !== "")
      .at(-1) ?? path
  );
}
