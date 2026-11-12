import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ForgeContractViolation } from "../src/data/forgeErrors";
import { createForgeQueryResource, forgeQueryRemoteValue } from "../src/data/forgeQueryResource";

const PATCHED_COUNT = 2;
const RETRY_DELAY_TOTAL_MS = 1750;
const TOTAL_ATTEMPTS = 4;

afterEach(() => {
  vi.useRealTimers();
});

describe("forge query resource", () => {
  it("deduplicates concurrent preloads through one query cache entry", async () => {
    let resolveLoad: ((value: string) => void) | undefined;
    const load = vi.fn(async () => {
      const value = await new Promise<string>((resolve) => {
        resolveLoad = resolve;
      });
      return value;
    });
    const resource = createForgeQueryResource({
      client: new QueryClient(),
      keyOf: (id: string) => ["test", id],
      load,
    });

    const first = resource.preload("same");
    const second = resource.preload("same");
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);

    resolveLoad?.("value");
    await expect(Promise.all([first, second])).resolves.toStrictEqual(["value", "value"]);
  });

  it("retries an unreachable read three times before surfacing the error", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => {
      await Promise.resolve();
      throw new Error("offline");
    });
    const resource = createForgeQueryResource({
      client: new QueryClient(),
      keyOf: (id: string) => ["test", id],
      load,
    });

    const result = resource.preload("retry");
    const rejected = expect(result).rejects.toThrow("offline");
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_TOTAL_MS);

    await rejected;
    expect(load).toHaveBeenCalledTimes(TOTAL_ATTEMPTS);
  });

  it("does not retry a contract violation", async () => {
    const load = vi.fn(async () => {
      await Promise.resolve();
      throw new ForgeContractViolation("fixture");
    });
    const resource = createForgeQueryResource({
      client: new QueryClient(),
      keyOf: (id: string) => ["test", id],
      load,
    });

    await expect(resource.preload("invalid")).rejects.toThrow(
      "The companion sent an invalid fixture result",
    );
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("publishes and patches acknowledged values in the query cache", () => {
    const resource = createForgeQueryResource({
      client: new QueryClient(),
      keyOf: (id: string) => ["test", id],
      load: async () => {
        await Promise.resolve();
        return { count: 0 };
      },
    });

    resource.publish("item", { count: 1 });
    resource.patch("item", (current) => ({ count: current.count + 1 }));

    expect(resource.data("item")).toStrictEqual({ count: PATCHED_COUNT });
  });

  it("keeps restored data visible during refresh and after its error", () => {
    const data = "stored";

    expect(forgeQueryRemoteValue({ data, error: null, isFetching: true })).toStrictEqual({
      refreshing: true,
      status: "ready",
      value: "stored",
    });
    expect(
      forgeQueryRemoteValue({ data, error: new Error("offline"), isFetching: false }),
    ).toMatchObject({ status: "failed", value: "stored" });
  });
});
