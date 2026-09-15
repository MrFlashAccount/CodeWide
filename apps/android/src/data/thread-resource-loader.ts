import type { RpcClient } from "@codewide/sync-client";
import {
  mergeThreadResources,
  parseThreadChangeDiff,
  parseThreadResourcesPatch,
  type ThreadResourceLoadKind,
} from "./thread-resource-response";
import type { ThreadChangeDiffValue } from "./thread-resource-types";
import type {
  ThreadChangeScope,
  ThreadResourceKind,
  ThreadResourcesValue,
  WorkspaceResourceDatabase,
} from "./workspace-resource-database";
import { threadResourceKey } from "./workspace-resource-keys";

/** Existing resource publication, summary recency and qualified session access. */
export type ThreadResourceAuthority = {
  getResources(): {
    threadResources: Pick<WorkspaceResourceDatabase["threadResources"], "get">;
    putThreadResources: WorkspaceResourceDatabase["putThreadResources"];
  };
  getSession(connectionId: string): RpcClient | undefined;
  readRecencyAt(connectionId: string, threadId: string): Promise<number | null>;
  rpcAfterAttach(session: RpcClient, method: string, params: unknown): Promise<unknown>;
};

/** Owns deduplication, conflicting read serialization and kind-level publication. */
export function createThreadResourceLoader({
  getResources,
  getSession,
  readRecencyAt,
  rpcAfterAttach,
}: ThreadResourceAuthority) {
  const threadResourcesInFlight = new Map<string, Promise<ThreadResourcesValue>>();
  const loadThreadResources = async (
    connectionId: string,
    threadId: string,
    scope?: ThreadChangeScope,
    kind: ThreadResourceLoadKind = "all",
  ): Promise<ThreadResourcesValue> => {
    const key = threadResourceKey(connectionId, threadId);
    const inFlightKey = `${key}\u0000${kind}\u0000${scope ?? "initial"}`;
    const requestedKinds = threadResourceKinds(kind);
    const pending = threadResourcesInFlight.get(inFlightKey);
    if (pending !== undefined) return await pending;
    let conflict: Promise<ThreadResourcesValue> | undefined;
    for (const [candidate, operation] of threadResourcesInFlight) {
      if (!candidate.startsWith(`${key}\u0000`)) continue;
      const candidateKind = candidate.slice(`${key}\u0000`.length).split("\u0000", 1)[0];
      if (kind === "all" || candidateKind === "all" || candidateKind === kind) {
        conflict = operation;
        break;
      }
    }
    if (conflict !== undefined) {
      try {
        await conflict;
      } catch {
        // The requested resource still deserves its own retry after a
        // conflicting refresh failed.
      }
      const settled = getResources().threadResources.get(key);
      const settledReadyKinds = initializedThreadResourceKinds(settled);
      if (
        settled?.value !== null &&
        settled?.value !== undefined &&
        requestedKinds.every((requestedKind) => settledReadyKinds.includes(requestedKind)) &&
        (kind !== "changes" || scope === undefined || settled.value.changeScope === scope)
      )
        return settled.value;
      return await loadThreadResources(connectionId, threadId, scope, kind);
    }
    const operation = (async () => {
      const previousRow = getResources().threadResources.get(key);
      const previous = previousRow?.value ?? null;
      getResources().putThreadResources({
        id: key,
        connectionId,
        threadId,
        status: "loading",
        value: previous,
        error: null,
        pendingKinds: mergeThreadResourceKinds(previousRow?.pendingKinds ?? [], requestedKinds),
        readyKinds: initializedThreadResourceKinds(previousRow),
        resourceErrors: clearThreadResourceErrors(previousRow?.resourceErrors, requestedKinds),
      });
      try {
        const session = getSession(connectionId);
        if (session === undefined) throw new Error("Connection is not enabled");
        const expectedRecencyAt = await readRecencyAt(connectionId, threadId);
        const method =
          kind === "changes"
            ? "companion/threadChanges/read"
            : kind === "attachments"
              ? "companion/threadAttachments/read"
              : "companion/threadResources/read";
        const response = await rpcAfterAttach(session, method, {
          threadId,
          ...(scope === undefined ? {} : { changeScope: scope }),
          ...(expectedRecencyAt === null ? {} : { expectedRecencyAt }),
        });
        const patch = parseThreadResourcesPatch(response, threadId, kind);
        const current = getResources().threadResources.get(key);
        const value = mergeThreadResources(current?.value ?? previous, patch);
        const pendingKinds = subtractThreadResourceKinds(
          current?.pendingKinds ?? requestedKinds,
          requestedKinds,
        );
        getResources().putThreadResources({
          id: key,
          connectionId,
          threadId,
          status: pendingKinds.length > 0 ? "loading" : "ready",
          value,
          error: null,
          pendingKinds,
          readyKinds: mergeThreadResourceKinds(
            initializedThreadResourceKinds(current),
            requestedKinds,
          ),
          resourceErrors: clearThreadResourceErrors(current?.resourceErrors, requestedKinds),
        });
        return getResources().threadResources.get(key)?.value ?? value;
      } catch (cause) {
        const current = getResources().threadResources.get(key);
        const pendingKinds = subtractThreadResourceKinds(
          current?.pendingKinds ?? requestedKinds,
          requestedKinds,
        );
        const message = errorMessage(cause);
        getResources().putThreadResources({
          id: key,
          connectionId,
          threadId,
          status: pendingKinds.length > 0 ? "loading" : "error",
          value: current?.value ?? previous,
          error: message,
          pendingKinds,
          readyKinds: initializedThreadResourceKinds(current),
          resourceErrors: setThreadResourceErrors(current?.resourceErrors, requestedKinds, message),
        });
        throw cause;
      }
    })();
    threadResourcesInFlight.set(inFlightKey, operation);
    try {
      return await operation;
    } finally {
      if (threadResourcesInFlight.get(inFlightKey) === operation)
        threadResourcesInFlight.delete(inFlightKey);
    }
  };

  const loadThreadChangeDiff = async (
    connectionId: string,
    threadId: string,
    path: string,
    scope?: ThreadChangeScope,
  ): Promise<ThreadChangeDiffValue> => {
    const session = getSession(connectionId);
    if (session === undefined) throw new Error("Connection is not enabled");
    const response = await rpcAfterAttach(session, "companion/threadChange/read", {
      threadId,
      path,
      ...(scope === undefined ? {} : { changeScope: scope }),
    });
    return parseThreadChangeDiff(response, threadId, path, scope);
  };

  return { loadThreadResources, loadThreadChangeDiff };
}

function threadResourceKinds(kind: ThreadResourceLoadKind): readonly ThreadResourceKind[] {
  return kind === "all" ? ["changes", "attachments"] : [kind];
}

function mergeThreadResourceKinds(
  current: readonly ThreadResourceKind[],
  requested: readonly ThreadResourceKind[],
): ThreadResourceKind[] {
  const result: ThreadResourceKind[] = [];
  for (const kind of current) if (!result.includes(kind)) result.push(kind);
  for (const kind of requested) if (!result.includes(kind)) result.push(kind);
  return result;
}

function initializedThreadResourceKinds(
  row:
    | { value: ThreadResourcesValue | null; readyKinds?: readonly ThreadResourceKind[] }
    | undefined,
): readonly ThreadResourceKind[] {
  if (row?.readyKinds !== undefined) return row.readyKinds;
  return row?.value == null ? [] : ["changes", "attachments"];
}

function subtractThreadResourceKinds(
  current: readonly ThreadResourceKind[],
  completed: readonly ThreadResourceKind[],
): ThreadResourceKind[] {
  return current.filter((kind) => !completed.includes(kind));
}

function clearThreadResourceErrors(
  current: Partial<Record<ThreadResourceKind, string>> | undefined,
  requested: readonly ThreadResourceKind[],
): Partial<Record<ThreadResourceKind, string>> {
  const next = { ...current };
  for (const kind of requested) delete next[kind];
  return next;
}

function setThreadResourceErrors(
  current: Partial<Record<ThreadResourceKind, string>> | undefined,
  requested: readonly ThreadResourceKind[],
  message: string,
): Partial<Record<ThreadResourceKind, string>> {
  const next = { ...current };
  for (const kind of requested) next[kind] = message;
  return next;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Remote operation failed";
}
