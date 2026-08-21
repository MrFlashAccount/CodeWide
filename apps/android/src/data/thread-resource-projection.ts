import type { ThreadProjectionPatchV1 } from "@codewide/sync-client";

import { normalizeFileChangeKind, projectFileChange } from "../rendering/file-change-rendering";
import type { ThreadChangeResource, ThreadResourcesValue } from "./workspace-resource-database";

/**
 * Applies the file-change payload already delivered by the Companion stream to
 * the cached Changes summary. The full resource RPC remains the reconciliation
 * boundary when a thread or the Changes view is opened.
 */
export function projectThreadResourcePatch(
  previous: ThreadResourcesValue,
  cwd: string,
  patch: ThreadProjectionPatchV1,
  cursor: number,
): ThreadResourcesValue {
  if (patch.threadId !== previous.threadId || !projectsLiveFileChanges(previous.changeScope)) return previous;

  const operation = patch.operation;
  let changes = previous.changes;
  if (operation.kind === "turnStarted" && previous.changeScope === "lastTurn") changes = [];

  const items = fileChangeItems(operation);
  for (const item of items) {
    changes = projectFileChangeItem(changes, cwd, item.turnId, item.itemId, item.changes);
  }
  if (changes === previous.changes) return previous;
  return { ...previous, revision: `event.${cursor}`, changes };
}

function projectsLiveFileChanges(scope: ThreadResourcesValue["changeScope"]): boolean {
  return scope === "session" || scope === "lastTurn" || scope === "unstaged" || scope === "branch";
}

type FileChangeItem = {
  turnId: string;
  itemId: string;
  changes: unknown[];
};

function fileChangeItems(operation: ThreadProjectionPatchV1["operation"]): FileChangeItem[] {
  if (operation.kind === "fileChanges") {
    return typeof operation.turnId === "string"
      && typeof operation.itemId === "string"
      && Array.isArray(operation.changes)
      ? [{ turnId: operation.turnId, itemId: operation.itemId, changes: operation.changes }]
      : [];
  }
  if (operation.kind === "itemUpsert") {
    return fileChangeItem(operation.turnId, operation.item);
  }
  if (operation.kind !== "turnStarted" && operation.kind !== "turnCompleted") return [];
  const turn = asRecord(operation.turn);
  if (turn === null || typeof turn.id !== "string" || !Array.isArray(turn.items)) return [];
  return turn.items.flatMap((item) => fileChangeItem(turn.id, item));
}

function fileChangeItem(turnId: unknown, rawItem: unknown): FileChangeItem[] {
  const item = asRecord(rawItem);
  return typeof turnId === "string"
    && item?.type === "fileChange"
    && typeof item.id === "string"
    && Array.isArray(item.changes)
    ? [{ turnId, itemId: item.id, changes: item.changes }]
    : [];
}

function projectFileChangeItem(
  previous: ThreadChangeResource[],
  cwd: string,
  turnId: string,
  itemId: string,
  rawChanges: unknown[],
): ThreadChangeResource[] {
  const projected = rawChanges.flatMap((raw): ThreadChangeResource[] => {
    const change = asRecord(raw);
    if (change === null || typeof change.path !== "string") return [];
    const rawKind = change.kind;
    const kind = normalizeFileChangeKind(rawKind);
    const movedPath = asRecord(rawKind)?.move_path;
    const path = resolveRemotePath(typeof movedPath === "string" && movedPath !== "" ? movedPath : change.path, cwd);
    if (path === null) return [];
    const diff = typeof change.diff === "string" ? change.diff : "";
    const stats = projectFileChange(diff, rawKind);
    return [{
      path,
      kind,
      availability: kind === "delete" ? "deleted" : "available",
      additions: stats.additions,
      deletions: stats.deletions,
      turnId,
      itemId,
    }];
  });
  if (projected.length === 0) return previous;

  const next = previous.slice();
  for (const change of projected) {
    const index = next.findIndex((candidate) => candidate.path === change.path);
    if (index < 0) {
      next.push(change);
      continue;
    }
    const existing = next[index];
    if (existing === undefined) continue;
    next[index] = existing.turnId === turnId && existing.itemId === itemId
      ? change
      : {
          ...change,
          additions: existing.additions + change.additions,
          deletions: existing.deletions + change.deletions,
        };
  }
  return next;
}

function resolveRemotePath(value: string, cwd: string): string | null {
  const candidate = value.trim();
  if (candidate === "" || candidate.includes("\0")) return null;
  const absolute = candidate.startsWith("/") ? candidate : `${cwd.startsWith("/") ? cwd : "/workspace"}/${candidate}`;
  const segments: string[] = [];
  for (const segment of absolute.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
