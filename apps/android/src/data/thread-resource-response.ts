import type { ThreadChangeDiffValue } from "./thread-resource-types";
import type { ThreadChangeScope, ThreadResourcesValue } from "./workspace-resource-database";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}
export type ThreadResourceLoadKind = "all" | "changes" | "attachments";

export type ThreadResourcesPatch = Pick<ThreadResourcesValue, "threadId" | "revision"> & {
  changeScope: ThreadResourcesValue["changeScope"] | undefined;
  changeScopes: ThreadResourcesValue["changeScopes"] | undefined;
  changes: ThreadResourcesValue["changes"] | undefined;
  attachments: ThreadResourcesValue["attachments"] | undefined;
};

export function parseThreadResourcesPatch(
  value: unknown,
  expectedThreadId: string,
  kind: ThreadResourceLoadKind,
): ThreadResourcesPatch {
  const source = asRecord(value);
  if (
    source === null ||
    source.threadId !== expectedThreadId ||
    typeof source.revision !== "string"
  ) {
    throw new Error("Companion returned invalid thread resources");
  }
  const changes: ThreadResourcesValue["changes"] = [];
  if (Array.isArray(source.changes)) {
    const limit = Math.min(source.changes.length, 5_000);
    for (let index = 0; index < limit; index += 1) {
      const entry: unknown = source.changes[index];

      const item = asRecord(entry);
      if (
        item === null ||
        typeof item.path !== "string" ||
        (item.kind !== "add" && item.kind !== "delete" && item.kind !== "update") ||
        typeof item.additions !== "number" ||
        typeof item.deletions !== "number" ||
        typeof item.turnId !== "string" ||
        typeof item.itemId !== "string"
      )
        continue;
      changes.push({
        path: item.path,
        kind: item.kind,
        availability: parseChangeAvailability(item.availability, item.kind),
        additions: Math.max(0, Math.trunc(item.additions)),
        deletions: Math.max(0, Math.trunc(item.deletions)),
        binary: item.binary === true,
        turnId: item.turnId,
        itemId: item.itemId,
      });
    }
  }
  const attachments: ThreadResourcesValue["attachments"] = [];
  if (Array.isArray(source.attachments)) {
    const limit = Math.min(source.attachments.length, 5_000);
    for (let index = 0; index < limit; index += 1) {
      const entry: unknown = source.attachments[index];

      const item = asRecord(entry);
      if (
        item === null ||
        typeof item.key !== "string" ||
        typeof item.name !== "string" ||
        (item.kind !== "image" && item.kind !== "audio" && item.kind !== "file") ||
        (item.path !== null && typeof item.path !== "string") ||
        (item.url !== null && typeof item.url !== "string") ||
        (item.origin !== "user" && item.origin !== "agent") ||
        typeof item.turnId !== "string" ||
        typeof item.itemId !== "string"
      )
        continue;
      attachments.push({
        key: item.key,
        name: item.name,
        kind: item.kind,
        path: item.path,
        url: item.url,
        origin: item.origin,
        turnId: item.turnId,
        itemId: item.itemId,
      });
    }
  }
  const changeScope =
    parseThreadChangeScope(source.changeScope) ?? (kind === "attachments" ? null : "session");
  let changeScopes: ThreadChangeScope[] | null = null;
  if (changeScope !== null) {
    changeScopes = [];
    if (Array.isArray(source.changeScopes)) {
      for (const scope of source.changeScopes) {
        const parsed = parseThreadChangeScope(scope);
        if (parsed !== null && !changeScopes.includes(parsed)) changeScopes.push(parsed);
      }
    } else {
      changeScopes.push(changeScope);
    }
    if (!changeScopes.includes(changeScope)) changeScopes.unshift(changeScope);
  }
  return {
    threadId: expectedThreadId,
    revision: source.revision,
    changeScope: changeScope ?? undefined,
    changeScopes: changeScopes ?? undefined,
    changes: kind === "attachments" ? undefined : changes,
    attachments: kind === "changes" ? undefined : attachments,
  };
}

export function mergeThreadResources(
  previous: ThreadResourcesValue | null,
  patch: ThreadResourcesPatch,
): ThreadResourcesValue {
  return {
    threadId: patch.threadId,
    revision: patch.revision,
    changeScope: patch.changeScope ?? previous?.changeScope ?? "session",
    changeScopes: patch.changeScopes ?? previous?.changeScopes ?? [patch.changeScope ?? "session"],
    changes: patch.changes ?? previous?.changes ?? [],
    attachments: patch.attachments ?? previous?.attachments ?? [],
  };
}

export function parseThreadChangeDiff(
  value: unknown,
  expectedThreadId: string,
  requestedPath: string,
  requestedScope?: ThreadChangeScope,
): ThreadChangeDiffValue {
  const source = asRecord(value);
  if (
    source === null ||
    source.threadId !== expectedThreadId ||
    typeof source.path !== "string" ||
    typeof source.truncated !== "boolean" ||
    !Array.isArray(source.patches)
  )
    throw new Error("Companion returned an invalid thread change diff");
  const patches: ThreadChangeDiffValue["patches"] = [];
  {
    const limit = Math.min(source.patches.length, 10_000);
    for (let index = 0; index < limit; index += 1) {
      const entry: unknown = source.patches[index];

      const patch = asRecord(entry);
      if (
        patch === null ||
        typeof patch.turnId !== "string" ||
        typeof patch.itemId !== "string" ||
        (patch.kind !== "add" && patch.kind !== "delete" && patch.kind !== "update") ||
        typeof patch.diff !== "string"
      )
        continue;
      patches.push({
        turnId: patch.turnId,
        itemId: patch.itemId,
        kind: patch.kind,
        diff: patch.diff,
      });
    }
  }
  const normalizedRequested = requestedPath.replaceAll("\\", "/").replace(/^\/+/, "");
  const normalizedReturned = source.path.replaceAll("\\", "/");
  if (
    normalizedReturned !== requestedPath.replaceAll("\\", "/") &&
    !normalizedReturned.endsWith(`/${normalizedRequested}`)
  ) {
    throw new Error("Companion returned a diff for a different path");
  }
  const changeScope = parseThreadChangeScope(source.changeScope) ?? requestedScope ?? "session";
  if (requestedScope !== undefined && changeScope !== requestedScope) {
    throw new Error("Companion returned a diff for a different change scope");
  }
  const scopedSource = typeof source.source === "string" ? source.source : null;
  return {
    threadId: expectedThreadId,
    path: source.path,
    changeScope,
    patches,
    source: scopedSource,
    truncated: source.truncated,
  };
}

function parseThreadChangeScope(value: unknown): ThreadChangeScope | null {
  return value === "session" ||
    value === "lastTurn" ||
    value === "staged" ||
    value === "unstaged" ||
    value === "branch"
    ? value
    : null;
}

function parseChangeAvailability(
  value: unknown,
  kind: unknown,
): ThreadResourcesValue["changes"][number]["availability"] {
  if (value === "available" || value === "deleted" || value === "unavailable") return value;
  return kind === "delete" ? "deleted" : "unknown";
}
