import { afterEach, describe, expect, it, vi } from "vitest";

import { asyncResourceCacheKey, getAsyncResource } from "../src/rendering/async-resource-store";

afterEach(() => {
  vi.useRealTimers();
});

describe("async resource identity", () => {
  it("gives every request revision its own cached resource", () => {
    expect(asyncResourceCacheKey("document", "offset:0")).not.toBe(asyncResourceCacheKey("document", "offset:1024"));
    expect(asyncResourceCacheKey("document", "offset:0")).toBe(asyncResourceCacheKey("document", "offset:0"));
  });

  it("retries an observed progressive resource and preserves its partial value", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const resource = getAsyncResource(
      `retry-${crypto.randomUUID()}`,
      1,
      async (publish) => {
        attempts += 1;
        if (attempts === 1) {
          publish("partial");
          throw new Error("offline");
        }
        return "complete";
      },
      (value) => value.length,
      true,
    );
    const release = resource.retain();

    await vi.advanceTimersByTimeAsync(0);
    expect(resource.snapshot$.peek()).toEqual({ status: "error", value: "partial", error: "offline" });

    await vi.advanceTimersByTimeAsync(250);
    expect(attempts).toBe(2);
    expect(resource.snapshot$.peek()).toEqual({ status: "ready", value: "complete", error: null });

    release();
  });
});
