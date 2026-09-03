import type { V2Query, V2QueryResult, V2TurnView } from "@codewide/sync-client/v2";
import { describe, expect, it, vi } from "vitest";

import {
  THREAD_HISTORY_RESIDENT_LIMIT,
  type ThreadHistorySearchSeed,
} from "../src/v2/application/resources/threadHistoryResource";
import {
  ThreadSearchResource,
  THREAD_SEARCH_PAGE_TRAVERSAL_LIMIT,
} from "../src/v2/application/resources/threadSearchResource";

const LIVE_START = 64;
const OLDER_START = 28;
const OLDER_MATCH = 40;
const LIVE_FIRST_MATCH = 70;
const LIVE_LAST_MATCH = 90;
const FAR_TAIL_START = 1000;
const FIRST_OLDER_START = FAR_TAIL_START - THREAD_HISTORY_RESIDENT_LIMIT;
const REPEATED_MOUNTS = 100;

describe("ThreadSearchResource", () => {
  it("finds a long-thread match outside the resident live window without materializing the thread", async () => {
    const source = new SearchSource(
      seed({
        count: THREAD_HISTORY_RESIDENT_LIMIT,
        newerCursor: null,
        olderCursor: "older-64",
        start: LIVE_START,
      }),
    );
    const execute = vi.fn<(query: V2Query) => Promise<V2QueryResult>>();
    execute.mockResolvedValue(
      historyPage({
        count: THREAD_HISTORY_RESIDENT_LIMIT,
        match: OLDER_MATCH,
        newerCursor: "newer-64",
        olderCursor: "older-28",
        start: OLDER_START,
      }),
    );
    const resource = new ThreadSearchResource({ execute, source, threadId: "thread-1" });

    resource.setQuery("needle");
    await resource.moveOlder();

    expect(resource.snapshot().value.selectedTurnId).toBe(`turn-${String(OLDER_MATCH)}`);
    expect(resource.snapshot().value.turns).toHaveLength(THREAD_HISTORY_RESIDENT_LIMIT);
    expect(resource.snapshot().value.matchCount).toBe(1);
    expect(execute).toHaveBeenCalledWith({
      cursor: "older-64",
      detail: "summary",
      direction: "older",
      kind: "history.page",
      limit: THREAD_HISTORY_RESIDENT_LIMIT,
      threadId: "thread-1",
    });
  });

  it("moves between matches and pages while retaining only one bounded page", async () => {
    const source = new SearchSource(
      seed({
        count: THREAD_HISTORY_RESIDENT_LIMIT,
        matches: [LIVE_FIRST_MATCH, LIVE_LAST_MATCH],
        newerCursor: null,
        olderCursor: "older-64",
        start: LIVE_START,
      }),
    );
    const execute = vi.fn<(query: V2Query) => Promise<V2QueryResult>>();
    execute
      .mockResolvedValueOnce(
        historyPage({
          count: THREAD_HISTORY_RESIDENT_LIMIT,
          match: OLDER_MATCH,
          newerCursor: "newer-64",
          olderCursor: "older-28",
          start: OLDER_START,
        }),
      )
      .mockResolvedValueOnce(
        historyPage({
          count: THREAD_HISTORY_RESIDENT_LIMIT,
          match: LIVE_FIRST_MATCH,
          newerCursor: null,
          olderCursor: "older-64",
          start: LIVE_START,
        }),
      );
    const resource = new ThreadSearchResource({ execute, source, threadId: "thread-1" });

    resource.setQuery("needle");
    expect(resource.snapshot().value.selectedTurnId).toBe(`turn-${String(LIVE_LAST_MATCH)}`);
    await resource.moveOlder();
    expect(resource.snapshot().value.selectedTurnId).toBe(`turn-${String(LIVE_FIRST_MATCH)}`);
    await resource.moveOlder();
    expect(resource.snapshot().value.selectedTurnId).toBe(`turn-${String(OLDER_MATCH)}`);
    expect(resource.snapshot().value.turns).toHaveLength(THREAD_HISTORY_RESIDENT_LIMIT);
    await resource.moveNewer();
    expect(resource.snapshot().value.selectedTurnId).toBe(`turn-${String(LIVE_FIRST_MATCH)}`);
    expect(resource.snapshot().value.turns).toHaveLength(THREAD_HISTORY_RESIDENT_LIMIT);
  });

  it("bounds each traversal and can continue searching on the next action", async () => {
    const source = new SearchSource(
      seed({
        count: THREAD_HISTORY_RESIDENT_LIMIT,
        newerCursor: null,
        olderCursor: "cursor-0",
        start: FAR_TAIL_START,
      }),
    );
    const execute = vi.fn<(query: V2Query) => Promise<V2QueryResult>>();
    for (let page = 0; page < THREAD_SEARCH_PAGE_TRAVERSAL_LIMIT + 1; page += 1) {
      const start = FIRST_OLDER_START - page * THREAD_HISTORY_RESIDENT_LIMIT;
      execute.mockResolvedValueOnce(
        historyPage({
          count: THREAD_HISTORY_RESIDENT_LIMIT,
          match: page === THREAD_SEARCH_PAGE_TRAVERSAL_LIMIT ? start : null,
          newerCursor: `newer-${String(page)}`,
          olderCursor: `cursor-${String(page + 1)}`,
          start,
        }),
      );
    }
    const resource = new ThreadSearchResource({ execute, source, threadId: "thread-1" });

    resource.setQuery("needle");
    await resource.moveOlder();
    expect(execute).toHaveBeenCalledTimes(THREAD_SEARCH_PAGE_TRAVERSAL_LIMIT);
    expect(resource.snapshot().value.selectedTurnId).toBeNull();

    await resource.moveOlder();
    expect(execute).toHaveBeenCalledTimes(THREAD_SEARCH_PAGE_TRAVERSAL_LIMIT + 1);
    expect(resource.snapshot().value.selectedTurnId).not.toBeNull();
  });

  it("owns exactly one history subscription across repeated mounts", () => {
    const source = new SearchSource(
      seed({
        count: THREAD_HISTORY_RESIDENT_LIMIT,
        newerCursor: null,
        olderCursor: null,
        start: 0,
      }),
    );
    const resource = new ThreadSearchResource({
      execute: vi.fn(),
      source,
      threadId: "thread-1",
    });

    for (let index = 0; index < REPEATED_MOUNTS; index += 1) {
      const unsubscribe = resource.subscribe(() => undefined);
      expect(source.listenerCount).toBe(1);
      unsubscribe();
      expect(source.listenerCount).toBe(0);
    }
  });

  it("matches the structured tool error message", () => {
    const source = new SearchSource({
      generationId: "generation-1",
      newerCursor: null,
      olderCursor: null,
      turns: [
        {
          activity: null,
          completedAt: "2026-09-01T00:00:00Z",
          createdAt: "2026-09-01T00:00:00Z",
          durationMs: 1,
          id: "turn-tool-error",
          items: [
            {
              appContext: null,
              error: { message: "quota exhausted" },
              id: "tool-error",
              kind: "tool",
              name: "server-call",
              pluginId: null,
              readOnlyHint: null,
              status: "failed",
              success: false,
              summary: "Request failed",
            },
          ],
          lifecycle: [],
          state: "failed",
          threadId: "thread-1",
          usage: null,
        },
      ],
    });
    const resource = new ThreadSearchResource({
      execute: vi.fn(),
      source,
      threadId: "thread-1",
    });

    resource.setQuery("quota exhausted");

    expect(resource.snapshot().value.selectedTurnId).toBe("turn-tool-error");
  });

  it("keeps independent ownership when consumers reuse one callback", () => {
    const source = new SearchSource(
      seed({ count: 1, newerCursor: null, olderCursor: null, start: 0 }),
    );
    const resource = new ThreadSearchResource({
      execute: vi.fn(),
      source,
      threadId: "thread-1",
    });
    const listener = (): void => undefined;
    const unsubscribeFirst = resource.subscribe(listener);
    const unsubscribeSecond = resource.subscribe(listener);

    unsubscribeFirst();
    expect(source.listenerCount).toBe(1);
    unsubscribeFirst();
    expect(source.listenerCount).toBe(1);
    unsubscribeSecond();
    expect(source.listenerCount).toBe(0);
  });
});

class SearchSource {
  readonly #listeners = new Set<() => void>();
  readonly #seed: ThreadHistorySearchSeed;

  constructor(initial: ThreadHistorySearchSeed) {
    this.#seed = initial;
  }

  get listenerCount(): number {
    return this.#listeners.size;
  }

  searchSeed = (): ThreadHistorySearchSeed => this.#seed;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
}

interface SeedInput {
  count: number;
  matches?: number[];
  newerCursor: string | null;
  olderCursor: string | null;
  start: number;
}

interface HistoryPageInput {
  count: number;
  match: number | null;
  newerCursor: string | null;
  olderCursor: string | null;
  start: number;
}

function seed(input: SeedInput): ThreadHistorySearchSeed {
  const { count, matches = [], newerCursor, olderCursor, start } = input;
  return {
    generationId: "generation-1",
    newerCursor,
    olderCursor,
    turns: turns(start, count, matches),
  };
}

function historyPage(input: HistoryPageInput): Extract<V2QueryResult, { kind: "history.page" }> {
  const { count, match, newerCursor, olderCursor, start } = input;
  return {
    kind: "history.page",
    newerCursor,
    olderCursor,
    threadId: "thread-1",
    turns: turns(start, count, match === null ? [] : [match]),
  };
}

function turns(start: number, count: number, matches: number[]): V2TurnView[] {
  return Array.from({ length: count }, (_, offset) => {
    const turn = start + offset;
    return {
      activity: null,
      completedAt: "2026-09-01T00:00:00Z",
      createdAt: "2026-09-01T00:00:00Z",
      durationMs: 1,
      id: `turn-${String(turn)}`,
      items: [
        {
          id: `turn-${String(turn)}-text`,
          kind: "assistantText",
          text: matches.includes(turn) ? `needle ${String(turn)}` : `ordinary ${String(turn)}`,
        },
      ],
      lifecycle: [],
      state: "completed",
      threadId: "thread-1",
      usage: null,
    };
  });
}
