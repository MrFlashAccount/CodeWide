import type { ThreadChangeResource, ThreadChangeScope } from "./thread-resource-types";

/** Resolve recorded session steps to the file's final presence and origin. */
export function effectiveThreadChanges<Change extends ThreadChangeResource>(
  changes: readonly Change[],
  scope: ThreadChangeScope,
): readonly Change[] {
  if (scope !== "session") {
    return changes;
  }
  let visible: Change[] | null = null;
  for (const [index, change] of changes.entries()) {
    if (change.createdInScope === true && change.availability === "deleted") {
      visible ??= changes.slice(0, index);
    } else {
      visible?.push(change);
    }
  }
  return visible ?? changes;
}

/** Resolve tree status from the original presence and current file availability. */
export function effectiveSessionKind(
  change: ThreadChangeResource,
  scope: ThreadChangeScope,
): ThreadChangeResource["kind"] {
  if (scope !== "session" || change.createdInScope === undefined) {
    return change.kind;
  }
  if (change.availability === "deleted") {
    return "delete";
  }
  if (change.availability === "available") {
    return change.createdInScope ? "add" : "update";
  }
  return change.kind;
}
