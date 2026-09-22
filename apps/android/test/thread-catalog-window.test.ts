import type { SyncSnapshotThread } from "@codewide/sync-client";
import { describe, expect, it, vi } from "vitest";
import { ThreadCatalogWindow } from "../src/data/thread-catalog-window";
import type {
  ThreadCatalogPage,
  ThreadCatalogPageRequest,
} from "../src/data/thread-catalog-loader";

function page(id: string, nextCursor: string | null): ThreadCatalogPage {
  // WHY: This window owns IDs and continuation only; the loader's separate
  // boundary tests validate the complete Thread DTO before it reaches this port.
  const row = { archived: false, thread: { id } } as SyncSnapshotThread;
  return { excludedThreadIds: [], nextCursor, threads: [row] };
}

function deferredPage() {
  let resolve!: (page: ThreadCatalogPage) => void;
  const promise = new Promise<ThreadCatalogPage>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("catalog continuation under live refresh", () => {
  it("publishes the requested continuation before servicing a concurrent refresh", async () => {
    const pending = deferredPage();
    const published: string[][] = [];
    const load = vi.fn(async (request: ThreadCatalogPageRequest) => {
      if (request.cursor === "older") return pending.promise;
      return page("head", "older");
    });
    const window = new ThreadCatalogWindow(
      {
        close() {},
        load,
        async publish(_rows, _archived, ids) {
          published.push([...ids]);
        },
      },
      false,
    );
    await window.ensure(1);
    const continuation = window.ensure(2);
    const refresh = window.refresh();
    // A later head refresh may finish, but it must not discard this older page.
    load.mockImplementation(async (request) =>
      request.cursor === null ? page("new-head", "refreshed-older") : page("head", null),
    );
    pending.resolve(page("older-thread", null));
    await Promise.all([continuation, refresh]);
    expect(published).toEqual([
      ["head"],
      ["head", "older-thread"],
      ["new-head"],
      ["new-head", "head"],
    ]);
  });

  it("makes progress through a multi-page prefix despite refresh during each read", async () => {
    const published: string[][] = [];
    let window: ThreadCatalogWindow;
    let reads = 0;
    const refreshes: Promise<void>[] = [];
    const load = vi.fn(async (request: ThreadCatalogPageRequest) => {
      await Promise.resolve();
      reads += 1;
      if (reads > 10) throw new Error("refresh starved continuation");
      if (reads <= 3) refreshes.push(window.refresh());
      return request.cursor === null
        ? page("a", "b")
        : request.cursor === "b"
          ? page("b", "c")
          : page("c", null);
    });
    window = new ThreadCatalogWindow(
      {
        close() {},
        load,
        async publish(_rows, _archived, ids) {
          published.push([...ids]);
        },
      },
      false,
    );
    await window.ensure(3);
    await Promise.all(refreshes);
    expect(published.slice(0, 3)).toEqual([["a"], ["a", "b"], ["a", "b", "c"]]);
    expect(published.at(-1)).toEqual(["a", "b", "c"]);
  });

  it("settles user demand without waiting for a subsequent background refresh", async () => {
    const pending = deferredPage();
    const background = deferredPage();
    let reads = 0;
    const window = new ThreadCatalogWindow(
      {
        close() {},
        async load() {
          reads += 1;
          return reads === 1 ? pending.promise : background.promise;
        },
        async publish() {},
      },
      false,
    );
    const demand = window.ensure(1);
    const refresh = window.refresh();
    pending.resolve(page("head", null));
    await demand;
    // The background request deliberately remains unresolved at this point.
    background.resolve(page("new-head", null));
    await refresh;
  });

  it("retries a failed publication from the committed cursor and ignores late results after close", async () => {
    const pending = deferredPage();
    const load = vi.fn(async (request: ThreadCatalogPageRequest) =>
      request.cursor === null ? page("head", "older") : pending.promise,
    );
    const publish = vi.fn(async () => undefined);
    const close = vi.fn();
    const window = new ThreadCatalogWindow({ close, load, publish }, false);
    publish.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(window.ensure(1)).rejects.toThrow("storage unavailable");
    await window.ensure(1);
    expect(load.mock.calls.map(([request]) => request.cursor)).toEqual([null, null]);
    const continuation = window.ensure(2);
    window.close();
    pending.resolve(page("older", null));
    await continuation;
    expect(publish).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
  });
});
