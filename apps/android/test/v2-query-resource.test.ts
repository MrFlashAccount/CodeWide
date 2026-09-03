import type {
  SyncV2ConnectionState,
  SyncV2Session,
  V2ProjectionChange,
  V2QueryResult,
} from "@codewide/sync-client/v2";
import { SyncV2RequestError } from "@codewide/sync-client/v2";
import { describe, expect, it, vi } from "vitest";

import { QueryResource } from "../src/v2/application/resources/queryResource";

describe("V2 query resource", () => {
  it("reruns after an invalidation arrives while the current query is in flight", async () => {
    let resolveFirst: ((result: V2QueryResult) => void) | null = null;
    let onChange: ((change: V2ProjectionChange) => void) | null = null;
    const first = new Promise<V2QueryResult>((resolve) => {
      resolveFirst = resolve;
    });
    const stale = resources("stale");
    const fresh = resources("fresh");
    const query = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(fresh);
    const session = {
      query,
      state: "live",
      subscribe: vi.fn(() => () => undefined),
      subscribeChange: vi.fn((listener: (change: V2ProjectionChange) => void) => {
        onChange = listener;
        return () => undefined;
      }),
    } as unknown as SyncV2Session;
    const resource = new QueryResource(session, {
      cursor: null,
      kind: "thread.resources",
      limit: 100,
      scope: "session",
      threadId: "thread",
    });

    const unsubscribe = resource.subscribe(() => undefined);
    await waitFor(() => query.mock.calls.length === 1);
    onChange?.({ kind: "resourcesChanged", revision: "2", threadId: "thread" });
    resolveFirst?.(stale);

    await waitFor(
      () =>
        resource.snapshot().value?.kind === "thread.resources" &&
        resource.snapshot().value?.revision === "fresh",
    );
    expect(query).toHaveBeenCalledTimes(2);
    expect(resource.snapshot()).toMatchObject({
      authority: "live",
      status: "ready",
      value: { revision: fresh.revision },
    });
    unsubscribe();
  });

  it("materializes changes and attachments beyond the first hundred resources", async () => {
    const firstChanges = Array.from({ length: 100 }, (_, index) => change(index));
    const remainingChanges = Array.from({ length: 21 }, (_, index) => change(index + 100));
    const attachments = Array.from({ length: 17 }, (_, index) => attachment(index));
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        ...resources("revision-1"),
        changes: firstChanges,
        next: "resource-page-2",
      })
      .mockResolvedValueOnce({
        ...resources("revision-1"),
        attachments,
        changes: remainingChanges,
      });
    const harness = sessionHarness(query);
    const resource = new QueryResource(harness.session, {
      cursor: null,
      kind: "thread.resources",
      limit: 100,
      scope: "session",
      threadId: "thread",
    });
    const unsubscribe = resource.subscribe(() => undefined);

    await waitFor(() => resource.snapshot().authority === "live");
    const value = resource.snapshot().value;
    if (value?.kind !== "thread.resources") throw new Error("expected resources result");
    expect(value.changes).toHaveLength(121);
    expect(value.attachments).toHaveLength(17);
    expect(value.next).toBeNull();
    expect(query.mock.calls.map((call) => call[0].cursor)).toEqual([null, "resource-page-2"]);
    unsubscribe();
  });

  it("refreshes a thread goal only for its explicit invalidation", async () => {
    let onChange: ((change: V2ProjectionChange) => void) | null = null;
    const result: V2QueryResult = {
      goal: {
        createdAtMs: 1,
        objective: "Ship V2",
        status: "active",
        threadId: "thread",
        timeUsedSeconds: 0,
        tokenBudget: null,
        tokensUsed: 0,
        updatedAtMs: 1,
      },
      kind: "thread.goal",
      threadId: "thread",
    };
    const query = vi.fn().mockResolvedValue(result);
    const session = liveSession(query, (listener) => {
      onChange = listener;
    });
    const resource = new QueryResource(session, { kind: "thread.goal", threadId: "thread" });

    const unsubscribe = resource.subscribe(() => undefined);
    await waitFor(() => query.mock.calls.length === 1);
    expect(onChange).not.toBeNull();
    const emit = onChange as (change: V2ProjectionChange) => void;
    emit({ kind: "threadGoalChanged", revision: "2", threadId: "other" });
    emit({ kind: "skillsChanged", revision: "3", workspace: null });
    expect(query).toHaveBeenCalledTimes(1);

    emit({ kind: "threadGoalChanged", revision: "4", threadId: "thread" });
    await waitFor(() => query.mock.calls.length >= 2);
    unsubscribe();
  });

  it("refreshes skills for matching and global workspace invalidations", async () => {
    let onChange: ((change: V2ProjectionChange) => void) | null = null;
    const result: V2QueryResult = {
      kind: "skills.list",
      skills: [],
      workspace: "/workspace",
    };
    const query = vi.fn().mockResolvedValue(result);
    const session = liveSession(query, (listener) => {
      onChange = listener;
    });
    const resource = new QueryResource(session, {
      forceReload: false,
      kind: "skills.list",
      workspace: "/workspace",
    });

    const unsubscribe = resource.subscribe(() => undefined);
    await waitFor(() => query.mock.calls.length === 1);
    expect(onChange).not.toBeNull();
    const emit = onChange as (change: V2ProjectionChange) => void;
    emit({ kind: "skillsChanged", revision: "2", workspace: "/other" });
    expect(query).toHaveBeenCalledTimes(1);

    emit({ kind: "skillsChanged", revision: "3", workspace: "/workspace" });
    await waitFor(() => query.mock.calls.length >= 2);
    emit({ kind: "skillsChanged", revision: "4", workspace: null });
    await waitFor(() => query.mock.calls.length >= 3);
    unsubscribe();
  });

  it("releases session observers after every repeated consumer mount and unmount", async () => {
    const harness = sessionHarness(vi.fn(async () => resources("live")));
    const resource = new QueryResource(harness.session, {
      cursor: null,
      kind: "thread.resources",
      limit: 100,
      scope: "session",
      threadId: "thread",
    });

    for (let cycle = 0; cycle < 100; cycle += 1) {
      const unsubscribe = resource.subscribe(() => undefined);
      expect(harness.stateListenerCount()).toBe(1);
      expect(harness.changeListenerCount()).toBe(1);
      unsubscribe();
      expect(harness.stateListenerCount()).toBe(0);
      expect(harness.changeListenerCount()).toBe(0);
    }
  });

  it("keeps retained values visible but non-actionable until reconnect refresh succeeds", async () => {
    const next = deferred<V2QueryResult>();
    const current = resources("current");
    const fresh = resources("fresh");
    const query = vi.fn().mockResolvedValueOnce(current).mockReturnValueOnce(next.promise);
    const harness = sessionHarness(query);
    const resource = new QueryResource(harness.session, {
      cursor: null,
      kind: "thread.resources",
      limit: 100,
      scope: "session",
      threadId: "thread",
    });
    const unsubscribe = resource.subscribe(() => undefined);
    await waitFor(() => resource.snapshot().authority === "live");

    harness.setState("offline");
    expect(resource.snapshot()).toEqual({
      authority: "retained",
      status: "loading",
      value: current,
    });
    expect(resource.actionable()).toBe(false);

    harness.setState("live");
    await waitFor(() => query.mock.calls.length === 2);
    expect(resource.snapshot()).toEqual({
      authority: "retained",
      status: "loading",
      value: current,
    });
    next.resolve(fresh);
    await waitFor(() => resource.snapshot().authority === "live");
    expect(resource.snapshot()).toEqual({ authority: "live", status: "ready", value: fresh });
    expect(resource.actionable()).toBe(true);
    unsubscribe();
  });

  it("does not let an abandoned pre-disconnect query block reconnect authority", async () => {
    const abandoned = deferred<V2QueryResult>();
    const fresh = resources("fresh");
    const query = vi.fn().mockReturnValueOnce(abandoned.promise).mockResolvedValueOnce(fresh);
    const harness = sessionHarness(query);
    const resource = new QueryResource(harness.session, {
      cursor: null,
      kind: "thread.resources",
      limit: 100,
      scope: "session",
      threadId: "thread",
    });
    const unsubscribe = resource.subscribe(() => undefined);
    await waitFor(() => query.mock.calls.length === 1);

    harness.setState("offline");
    harness.setState("live");
    await waitFor(
      () =>
        resource.snapshot().authority === "live" &&
        resource.snapshot().value?.kind === "thread.resources" &&
        resource.snapshot().value?.revision === "fresh",
    );

    abandoned.resolve(resources("abandoned"));
    await Promise.resolve();
    expect(resource.snapshot().value).toMatchObject({ revision: "fresh" });
    unsubscribe();
  });

  it("keeps a retained value disabled and surfaces an error when reconnect refresh fails", async () => {
    const current = resources("current");
    const query = vi
      .fn()
      .mockResolvedValueOnce(current)
      .mockRejectedValueOnce(new Error("network failed"));
    const harness = sessionHarness(query);
    const resource = new QueryResource(harness.session, {
      cursor: null,
      kind: "thread.resources",
      limit: 100,
      scope: "session",
      threadId: "thread",
    });
    const unsubscribe = resource.subscribe(() => undefined);
    await waitFor(() => resource.snapshot().authority === "live");

    harness.setState("offline");
    harness.setState("live");
    await waitFor(() => resource.snapshot().status === "error");
    expect(resource.snapshot()).toEqual({
      authority: "retained",
      failure: expect.objectContaining({ error: null, message: "network failed" }),
      message: "network failed",
      status: "error",
      value: current,
    });
    expect(resource.actionable()).toBe(false);
    unsubscribe();
  });

  it("preserves a typed server query failure through the retained retry boundary", async () => {
    const current = resources("current");
    const detail = {
      code: "staleCursor",
      message: "This cursor is stale; refresh the resource",
      recovery: "requery",
    } as const;
    const failure = new SyncV2RequestError(detail);
    const query = vi.fn().mockResolvedValueOnce(current).mockRejectedValueOnce(failure);
    const harness = sessionHarness(query);
    const resource = new QueryResource(harness.session, {
      cursor: null,
      kind: "thread.resources",
      limit: 100,
      scope: "session",
      threadId: "thread",
    });
    const unsubscribe = resource.subscribe(() => undefined);
    await waitFor(() => resource.snapshot().authority === "live");

    harness.setState("offline");
    harness.setState("live");
    await waitFor(() => resource.snapshot().status === "error");
    const snapshot = resource.snapshot();
    expect(snapshot.status).toBe("error");
    if (snapshot.status !== "error") throw new Error("expected query failure");
    expect(snapshot.message).toBe(detail.message);
    expect(snapshot.failure).toStrictEqual({
      cause: failure,
      error: detail,
      message: detail.message,
    });
    unsubscribe();
  });

  it("keeps one observer pair across repeated reconnect refreshes", async () => {
    const query = vi.fn(async () => resources(String(query.mock.calls.length)));
    const harness = sessionHarness(query);
    const resource = new QueryResource(harness.session, {
      cursor: null,
      kind: "thread.resources",
      limit: 100,
      scope: "session",
      threadId: "thread",
    });
    const unsubscribe = resource.subscribe(() => undefined);
    await waitFor(() => query.mock.calls.length === 1 && resource.actionable());

    for (let cycle = 0; cycle < 50; cycle += 1) {
      harness.setState("offline");
      expect(resource.actionable()).toBe(false);
      harness.setState("live");
      await waitFor(() => query.mock.calls.length === cycle + 2 && resource.actionable());
      expect(harness.stateListenerCount()).toBe(1);
      expect(harness.changeListenerCount()).toBe(1);
    }
    unsubscribe();
    expect(harness.stateListenerCount()).toBe(0);
    expect(harness.changeListenerCount()).toBe(0);
  });

  it("loads queued prompts one authoritative page at a time", async () => {
    const first = Array.from({ length: 100 }, (_, index) => queueItem(index));
    const second = Array.from({ length: 100 }, (_, index) => queueItem(index + 100));
    const third = Array.from({ length: 5 }, (_, index) => queueItem(index + 200));
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        items: first,
        kind: "queue.list",
        nextCursor: "page-2",
        revision: "revision-1",
      })
      .mockResolvedValueOnce({
        items: second,
        kind: "queue.list",
        nextCursor: "page-3",
        revision: "revision-1",
      })
      .mockResolvedValueOnce({
        items: third,
        kind: "queue.list",
        nextCursor: null,
        revision: "revision-1",
      });
    const harness = sessionHarness(query);
    const resource = new QueryResource(harness.session, {
      cursor: null,
      kind: "queue.list",
      limit: 100,
      threadId: "thread",
    });
    const unsubscribe = resource.subscribe(() => undefined);

    await waitFor(() => resource.snapshot().authority === "live");
    let value = resource.snapshot().value;
    if (value?.kind !== "queue.list") throw new Error("expected queue result");
    expect(value.items).toHaveLength(100);
    expect(value.nextCursor).toBe("page-2");
    expect(query).toHaveBeenCalledTimes(1);

    await resource.loadMore();
    value = resource.snapshot().value;
    if (value?.kind !== "queue.list") throw new Error("expected queue result");
    expect(value.items).toHaveLength(200);
    expect(value.nextCursor).toBe("page-3");

    await resource.loadMore();
    value = resource.snapshot().value;
    if (value?.kind !== "queue.list") throw new Error("expected queue result");
    expect(value.items).toHaveLength(205);
    expect(value.nextCursor).toBeNull();
    expect(query.mock.calls.map((call) => call[0].cursor)).toEqual([null, "page-2", "page-3"]);
    unsubscribe();
  });

  it("continues cursor paging beyond one thousand queued prompts without hiding the tail", async () => {
    const query = vi.fn(async (_query) => {
      const page = query.mock.calls.length;
      const start = (page - 1) * 100;
      const length = Math.min(100, 1_105 - start);
      return {
        items: Array.from({ length }, (_, index) => queueItem(start + index)),
        kind: "queue.list" as const,
        nextCursor: start + length < 1_105 ? `page-${page + 1}` : null,
        revision: "revision-1",
      };
    });
    const harness = sessionHarness(query);
    const resource = new QueryResource(harness.session, {
      cursor: null,
      kind: "queue.list",
      limit: 100,
      threadId: "thread",
    });
    const unsubscribe = resource.subscribe(() => undefined);

    await waitFor(() => resource.snapshot().authority === "live");
    for (let page = 1; page < 10; page += 1) await resource.loadMore();
    let value = resource.snapshot().value;
    if (value?.kind !== "queue.list") throw new Error("expected queue result");
    expect(value.items).toHaveLength(1_000);
    expect(value.nextCursor).toBe("page-11");
    expect(query).toHaveBeenCalledTimes(10);

    await resource.loadMore();
    await resource.loadMore();
    value = resource.snapshot().value;
    if (value?.kind !== "queue.list") throw new Error("expected queue result");
    expect(value.items).toHaveLength(1_105);
    expect(value.items.at(-1)?.id).toBe("queue-1104");
    expect(value.nextCursor).toBeNull();
    expect(query).toHaveBeenCalledTimes(12);
    unsubscribe();
  });

  it("preserves and retries the exact failed queue continuation", async () => {
    const detail = {
      code: "sourceUnavailable",
      message: "Queue page is temporarily unavailable",
      recovery: "retry",
    } as const;
    const failure = new SyncV2RequestError(detail);
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        items: [queueItem(0)],
        kind: "queue.list",
        nextCursor: "page-2",
        revision: "revision-1",
      })
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({
        items: [queueItem(1)],
        kind: "queue.list",
        nextCursor: null,
        revision: "revision-1",
      });
    const harness = sessionHarness(query);
    const resource = new QueryResource(harness.session, {
      cursor: null,
      kind: "queue.list",
      limit: 100,
      threadId: "thread",
    });
    const unsubscribe = resource.subscribe(() => undefined);
    await waitFor(() => resource.snapshot().authority === "live");

    await resource.loadMore();
    const failed = resource.snapshot();
    expect(failed.status).toBe("error");
    if (failed.status !== "error") throw new Error("expected queue page failure");
    expect(failed).toMatchObject({
      authority: "retained",
      failure: { cause: failure, error: detail, message: detail.message },
      message: detail.message,
      operation: "loadMore",
    });
    expect(resource.actionable()).toBe(false);

    await resource.loadMore();
    const recovered = resource.snapshot();
    expect(recovered).toMatchObject({ authority: "live", status: "ready" });
    if (recovered.value?.kind !== "queue.list") throw new Error("expected queue result");
    expect(recovered.value.items.map((item) => item.id)).toEqual(["queue-0", "queue-1"]);
    expect(query.mock.calls.map((call) => call[0].cursor)).toEqual([null, "page-2", "page-2"]);
    unsubscribe();
  });

  it("rejects a repeated queue cursor instead of duplicating the same page", async () => {
    const first = Array.from({ length: 100 }, (_, index) => queueItem(index));
    const query = vi.fn().mockResolvedValue({
      items: first,
      kind: "queue.list",
      nextCursor: "same-page",
      revision: "revision-1",
    });
    const harness = sessionHarness(query);
    const resource = new QueryResource(harness.session, {
      cursor: "same-page",
      kind: "queue.list",
      limit: 100,
      threadId: "thread",
    });
    const unsubscribe = resource.subscribe(() => undefined);

    await waitFor(() => resource.snapshot().status === "error");
    expect(resource.snapshot()).toEqual({
      authority: "none",
      failure: expect.objectContaining({
        error: null,
        message: "Queue query returned a repeated cursor",
      }),
      message: "Queue query returned a repeated cursor",
      status: "error",
      value: null,
    });
    expect(query).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("materializes authoritative agent pages and refreshes only for the owning parent", async () => {
    let onChange: ((change: V2ProjectionChange) => void) | null = null;
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        agents: [agent("child-a", "parent")],
        kind: "thread.agents",
        next: "page-2",
        threadId: "parent",
      })
      .mockResolvedValueOnce({
        agents: [agent("child-b", "parent")],
        kind: "thread.agents",
        next: null,
        threadId: "parent",
      })
      .mockResolvedValueOnce({
        agents: [
          agent("child-a", "parent"),
          agent("child-b", "parent"),
          agent("child-c", "parent"),
        ],
        kind: "thread.agents",
        next: null,
        threadId: "parent",
      })
      .mockResolvedValueOnce({
        agents: [
          agent("child-a", "parent"),
          agent("child-b", "parent"),
          { ...agent("child-c", "parent"), title: "Renamed child" },
        ],
        kind: "thread.agents",
        next: null,
        threadId: "parent",
      })
      .mockResolvedValueOnce({
        agents: [],
        kind: "thread.agents",
        next: null,
        threadId: "parent",
      });
    const session = liveSession(query, (listener) => {
      onChange = listener;
    });
    const resource = new QueryResource(session, {
      cursor: null,
      kind: "thread.agents",
      limit: 100,
      threadId: "parent",
    });
    const unsubscribe = resource.subscribe(() => undefined);

    await waitFor(() => resource.snapshot().authority === "live");
    const first = resource.snapshot().value;
    if (first?.kind !== "thread.agents") throw new Error("expected thread agents result");
    expect(first.agents.map((value) => value.id)).toEqual(["child-a", "child-b"]);
    expect(query.mock.calls.map((call) => call[0].cursor)).toEqual([null, "page-2"]);
    expect(onChange).not.toBeNull();
    const emit = onChange as (change: V2ProjectionChange) => void;

    emit({ kind: "agentsChanged", revision: "other", threadId: "other-parent" });
    expect(query).toHaveBeenCalledTimes(2);
    emit({ kind: "agentsChanged", revision: "added", threadId: "parent" });
    await waitFor(() => {
      const value = resource.snapshot().value;
      return value?.kind === "thread.agents" && value.agents.length === 3;
    });
    emit({ kind: "agentsChanged", revision: "updated", threadId: "parent" });
    await waitFor(() => {
      const value = resource.snapshot().value;
      return (
        value?.kind === "thread.agents" &&
        value.agents.find((candidate) => candidate.id === "child-c")?.title === "Renamed child"
      );
    });
    emit({ kind: "agentsChanged", revision: "deleted", threadId: null });
    await waitFor(() => {
      const value = resource.snapshot().value;
      return value?.kind === "thread.agents" && value.agents.length === 0;
    });
    const removed = resource.snapshot().value;
    if (removed?.kind !== "thread.agents") throw new Error("expected thread agents result");
    expect(removed.agents).toEqual([]);
    unsubscribe();
  });
});

interface SessionHarness {
  changeListenerCount(): number;
  session: SyncV2Session;
  setState(state: SyncV2ConnectionState): void;
  stateListenerCount(): number;
}

function sessionHarness(query: ReturnType<typeof vi.fn>): SessionHarness {
  let state: SyncV2ConnectionState = "live";
  const stateListeners = new Set<() => void>();
  const changeListeners = new Set<(change: V2ProjectionChange) => void>();
  const session = {
    get state(): SyncV2ConnectionState {
      return state;
    },
    query,
    subscribe(listener: () => void): () => void {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    subscribeChange(listener: (change: V2ProjectionChange) => void): () => void {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
  } as unknown as SyncV2Session;
  return {
    changeListenerCount: () => changeListeners.size,
    session,
    setState(nextState) {
      state = nextState;
      for (const listener of stateListeners) listener();
    },
    stateListenerCount: () => stateListeners.size,
  };
}

function liveSession(
  query: ReturnType<typeof vi.fn>,
  captureChange: (listener: (change: V2ProjectionChange) => void) => void,
): SyncV2Session {
  return {
    query,
    state: "live",
    subscribe: vi.fn(() => () => undefined),
    subscribeChange: vi.fn((listener: (change: V2ProjectionChange) => void) => {
      captureChange(listener);
      return () => undefined;
    }),
  } as unknown as SyncV2Session;
}

function resources(revision: string): V2QueryResult {
  return {
    attachments: [],
    changes: [],
    kind: "thread.resources",
    next: null,
    revision,
    threadId: "thread",
  };
}

function change(index: number) {
  return {
    additions: String(index + 1),
    change: "update" as const,
    deletions: "0",
    path: `/workspace/file-${index}.ts`,
  };
}

function attachment(index: number) {
  return {
    downloadUrl: `/v2/files/preview?path=file-${index}.txt`,
    id: `attachment-${index}`,
    mediaType: "text/plain",
    name: `file-${index}.txt`,
    sizeBytes: "1",
  };
}

function queueItem(index: number) {
  return {
    id: `queue-${index}`,
    input: [{ kind: "text" as const, text: `prompt ${index}` }],
    lastError: null,
    position: String(index),
    state: "queued" as const,
    summary: `prompt ${index}`,
    threadId: "thread",
  };
}

function agent(id: string, parentId: string) {
  return {
    archived: false,
    createdAt: "2026-09-01T00:00:00Z",
    headTurnId: null,
    id,
    lastActivityAt: "2026-09-01T00:00:01Z",
    parentId,
    preview: "Working",
    readState: {
      kind: "unknown" as const,
      latestActivityMarker: null,
      readThroughMarker: null,
      unreadCount: null,
    },
    settings: null,
    state: "running" as const,
    title: id,
    updatedAt: "2026-09-01T00:00:01Z",
    workspace: "/workspace",
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("condition was not reached");
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
  };
}
