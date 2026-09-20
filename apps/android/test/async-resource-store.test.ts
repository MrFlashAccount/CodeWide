import { afterEach, describe, expect, it, vi } from "vitest";

import { asyncResourceCacheKey, getAsyncResource } from "../src/rendering/async-resource-store";

afterEach(() => {
  vi.useRealTimers();
});

describe("async resource identity", () => {
  it("shares a request promise and keeps progressive content visible between revisions", async () => {
    const key = `progress-${crypto.randomUUID()}`;
    let calls = 0;
    const first = getAsyncResource(
      key,
      1,
      async () => {
        calls += 1;
        return "first";
      },
      (value) => value.length,
      false,
    );
    expect(first.read()).toBe(first.read());
    await expect(first.read()).resolves.toBe("first");
    expect(calls).toBe(1);
    const second = getAsyncResource(
      key,
      2,
      async () => "first second",
      (value) => value.length,
      false,
      true,
    );
    expect(second.snapshot$.peek()).toEqual({ status: "loading", value: "first", error: null });
    await expect(second.read()).resolves.toBe("first second");
    expect(second.snapshot$.peek().value).toBe("first second");
  });
  it("gives every request revision its own cached resource", () => {
    expect(asyncResourceCacheKey("document", "offset:0")).not.toBe(
      asyncResourceCacheKey("document", "offset:1024"),
    );
    expect(asyncResourceCacheKey("document", "offset:0")).toBe(
      asyncResourceCacheKey("document", "offset:0"),
    );
  });

  it("keeps a resident resource across observer remounts", async () => {
    const key = `resident-${crypto.randomUUID()}`;
    let calls = 0;
    const first = getAsyncResource(
      key,
      1,
      async () => {
        calls += 1;
        return "image";
      },
      (value) => value.length,
      false,
    );
    const release = first.retain();
    await expect(first.read()).resolves.toBe("image");
    release();

    const remounted = getAsyncResource(
      key,
      1,
      async () => {
        calls += 1;
        return "reloaded";
      },
      (value) => value.length,
      false,
    );

    expect(remounted).toBe(first);
    await expect(remounted.read()).resolves.toBe("image");
    expect(calls).toBe(1);
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
    expect(resource.snapshot$.peek()).toEqual({
      status: "error",
      value: "partial",
      error: "offline",
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(attempts).toBe(2);
    expect(resource.snapshot$.peek()).toEqual({ status: "ready", value: "complete", error: null });

    release();
  });

  it("stops automatic retries after the bounded exponential budget", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const resource = getAsyncResource(
      `bounded-retry-${crypto.randomUUID()}`,
      1,
      async () => {
        attempts += 1;
        throw new Error("offline");
      },
      () => 1,
      true,
    );
    const release = resource.retain();

    await vi.runAllTimersAsync();
    expect(attempts).toBe(6);
    expect(resource.snapshot$.peek()).toEqual({ status: "error", value: null, error: "offline" });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempts).toBe(6);
    release();
  });

  it("does not automatically retry a permanent missing resource", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const resource = getAsyncResource(
      `missing-${crypto.randomUUID()}`,
      1,
      async () => {
        attempts += 1;
        throw new Error("Private image download failed (404)");
      },
      () => 1,
      true,
    );
    const release = resource.retain();

    await vi.runAllTimersAsync();
    expect(attempts).toBe(1);
    expect(resource.snapshot$.peek().status).toBe("error");
    release();
  });

  it("does not let a dependent read bypass the retry cooldown", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const resource = getAsyncResource(
      `cooldown-${crypto.randomUUID()}`,
      1,
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("offline");
        return "ready";
      },
      (value) => value.length,
      true,
    );
    const release = resource.retain();

    await vi.advanceTimersByTimeAsync(0);
    await expect(resource.read()).rejects.toThrow("offline");
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(resource.read()).resolves.toBe("ready");
    expect(attempts).toBe(2);
    release();
  });
});
