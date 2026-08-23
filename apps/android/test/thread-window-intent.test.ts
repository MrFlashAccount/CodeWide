import { describe, expect, it } from "vitest";

import { ThreadWindowIntentController } from "../src/data/thread-window-intent";

describe("thread window navigation intent", () => {
  it("keeps only the latest transient window", () => {
    const controller = new ThreadWindowIntentController();
    const releases: string[] = [];
    const first = controller.begin("connection\u0000first", "first-request", () => () => releases.push("first"));
    const second = controller.begin("connection\u0000second", "second-request", () => () => releases.push("second"));

    expect(releases).toEqual(["first"]);
    expect(controller.isCurrent(first.token)).toBe(false);
    expect(controller.isCurrent(second.token)).toBe(true);
  });

  it("does not let a stale gesture cancel its replacement", () => {
    const controller = new ThreadWindowIntentController();
    const releases: string[] = [];
    const first = controller.begin("connection\u0000first", "first-request", () => () => releases.push("first"));
    const second = controller.begin("connection\u0000second", "second-request", () => () => releases.push("second"));

    controller.cancel(first);

    expect(releases).toEqual(["first"]);
    expect(controller.isCurrent(second.token)).toBe(true);
  });

  it("does not invalidate a loader when the same intent is announced twice", () => {
    const controller = new ThreadWindowIntentController();
    let retains = 0;
    const first = controller.begin("connection\u0000thread", "request", () => {
      retains += 1;
      return () => undefined;
    });
    const duplicate = controller.begin("connection\u0000thread", "request", () => {
      retains += 1;
      return () => undefined;
    });

    expect(duplicate).toBe(first);
    expect(retains).toBe(1);
    expect(controller.isCurrent(first.token)).toBe(true);
  });

  it("transfers ownership without invalidating the in-flight read", () => {
    const controller = new ThreadWindowIntentController();
    const releases: string[] = [];
    const lease = controller.begin("connection\u0000thread", "request", () => () => releases.push("intent"));

    controller.adopt("connection\u0000thread");

    expect(releases).toEqual(["intent"]);
    expect(controller.isCurrent(lease.token)).toBe(true);
    controller.cancel(lease);
    expect(releases).toEqual(["intent"]);
  });

  it("invalidates a cancelled read and releases its window", () => {
    const controller = new ThreadWindowIntentController();
    const releases: string[] = [];
    const lease = controller.begin("connection\u0000thread", "request", () => () => releases.push("intent"));

    controller.cancel(lease);

    expect(releases).toEqual(["intent"]);
    expect(controller.isCurrent(lease.token)).toBe(false);
  });
});
