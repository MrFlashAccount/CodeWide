import { describe, expect, it, vi } from "vitest";

import { ThreadHistoryViewportFill } from "../src/data/thread-history-viewport-fill";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

describe("thread history viewport filling", () => {
  it("continues short pages without another gesture and stops once measured content fills the viewport", async () => {
    let contentHeight = 100;
    const loaded: string[] = [];
    const fill = new ThreadHistoryViewportFill({
      loadPage: async (direction) => { loaded.push(direction); return true; },
      afterLayout: async () => {
        contentHeight += 150;
        void fill.reportViewport(400, contentHeight);
      },
      isCurrent: () => true,
    });

    await fill.reportViewport(400, contentHeight);

    expect(loaded).toEqual(["older", "older"]);
    expect(contentHeight).toBe(400);
    await fill.reportViewport(400, 450);
    expect(loaded).toHaveLength(2);
  });

  it("uses the requested newer direction and waits for committed measurement before continuing", async () => {
    const layout = deferred();
    const loadPage = vi.fn(async () => true);
    const fill = new ThreadHistoryViewportFill({ loadPage, afterLayout: () => layout.promise, isCurrent: () => true });
    await fill.reportViewport(300, 400);
    const request = fill.load("newer");
    await Promise.resolve();
    expect(loadPage).toHaveBeenCalledExactlyOnceWith("newer");
    void fill.reportViewport(300, 500);
    layout.resolve();
    await request;
    expect(loadPage).toHaveBeenCalledTimes(1);
  });

  it("stops on no progress and does not retry on incidental content changes", async () => {
    const loadPage = vi.fn(async () => false);
    const fill = new ThreadHistoryViewportFill({ loadPage, afterLayout: async () => {}, isCurrent: () => true });
    await fill.reportViewport(500, 100);
    await fill.reportViewport(500, 110);
    expect(loadPage).toHaveBeenCalledTimes(1);
    await fill.load("older");
    expect(loadPage).toHaveBeenCalledTimes(2);
  });

  it("surfaces failure and waits for another explicit intent before retrying", async () => {
    const cause = new Error("history unavailable");
    const loadPage = vi.fn(async () => { throw cause; });
    const fill = new ThreadHistoryViewportFill({ loadPage, afterLayout: async () => {}, isCurrent: () => true });
    await expect(fill.reportViewport(500, 100)).rejects.toBe(cause);
    await fill.reportViewport(500, 120);
    expect(loadPage).toHaveBeenCalledTimes(1);
    await expect(fill.load("newer")).rejects.toBe(cause);
    expect(loadPage).toHaveBeenCalledTimes(2);
  });

  it("bounds downloads when all returned rows stay short or are filtered out", async () => {
    const loadPage = vi.fn(async () => true);
    const fill = new ThreadHistoryViewportFill({ loadPage, afterLayout: async () => {}, isCurrent: () => true });
    await fill.reportViewport(500, 100);
    expect(loadPage).toHaveBeenCalledTimes(4);
    await fill.reportViewport(500, 101);
    expect(loadPage).toHaveBeenCalledTimes(4);
  });

  it("does not continue an old intent after jump-to-latest cancellation", async () => {
    const page = deferred();
    const loadPage = vi.fn(async () => { await page.promise; return true; });
    const fill = new ThreadHistoryViewportFill({ loadPage, afterLayout: async () => {}, isCurrent: () => true });
    const request = fill.reportViewport(500, 100);
    await Promise.resolve();
    fill.cancel();
    page.resolve();
    await request;
    await fill.reportViewport(500, 120);
    expect(loadPage).toHaveBeenCalledTimes(1);
  });

  it("stops when the conversation owner changes", async () => {
    let current = true;
    const loadPage = vi.fn(async () => true);
    const fill = new ThreadHistoryViewportFill({
      loadPage,
      afterLayout: async () => { current = false; },
      isCurrent: () => current,
    });
    await fill.reportViewport(500, 100);
    expect(loadPage).toHaveBeenCalledTimes(1);
  });

  it("coalesces measurement events and duplicate edge intents during a page", async () => {
    const page = deferred();
    const loadPage = vi.fn(async () => { await page.promise; return false; });
    const fill = new ThreadHistoryViewportFill({ loadPage, afterLayout: async () => {}, isCurrent: () => true });
    const first = fill.reportViewport(500, 100);
    const second = fill.reportViewport(500, 120);
    const third = fill.load("older");
    page.resolve();
    await Promise.all([first, second, third]);
    expect(loadPage).toHaveBeenCalledTimes(1);
  });

  it("lets an opposite edge intent supersede continuation of a pending page", async () => {
    const olderPage = deferred();
    const directions: string[] = [];
    const fill = new ThreadHistoryViewportFill({
      loadPage: async (direction) => {
        directions.push(direction);
        if (direction === "older") await olderPage.promise;
        return direction === "older";
      },
      afterLayout: async () => {},
      isCurrent: () => true,
    });
    const older = fill.reportViewport(500, 100);
    await Promise.resolve();
    await fill.load("newer");
    olderPage.resolve();
    await older;
    expect(directions).toEqual(["older", "newer"]);
  });
});
