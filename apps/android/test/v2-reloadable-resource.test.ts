import { describe, expect, it } from "vitest";

import { ReloadableResource } from "../src/v2/application/resources/resource";

describe("ReloadableResource", () => {
  it("starts only after subscription and does not reload across remounts", async () => {
    let attempts = 0;
    const resource = new ReloadableResource({
      errorMessage: "Could not open resource",
      initialValue: "initial",
      load: async () => {
        attempts += 1;
        return "ready";
      },
    });

    await Promise.resolve();
    expect(attempts).toBe(0);
    const firstUnsubscribe = resource.subscribe(() => undefined);
    await waitForReady(resource);
    expect(attempts).toBe(1);
    firstUnsubscribe();

    const secondUnsubscribe = resource.subscribe(() => undefined);
    await Promise.resolve();
    expect(attempts).toBe(1);
    secondUnsubscribe();
  });

  it("publishes an explicit error and recovers through the same resource", async () => {
    let attempts = 0;
    const resource = new ReloadableResource<string | null>({
      errorMessage: "Could not open resource",
      initialValue: null,
      load: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("private transport detail");
        return "ready";
      },
    });

    await resource.refresh();
    expect(resource.snapshot()).toEqual({
      message: "Could not open resource",
      status: "error",
      value: null,
    });

    await resource.refresh();
    expect(resource.snapshot()).toEqual({ status: "ready", value: "ready" });
    expect(attempts).toBe(2);
  });

  it("deduplicates concurrent retries and retains the last value while loading", async () => {
    let resolve!: (value: string) => void;
    let attempts = 0;
    const resource = new ReloadableResource({
      errorMessage: "Could not refresh resource",
      initialValue: "retained",
      load: () => {
        attempts += 1;
        return new Promise<string>((accept) => {
          resolve = accept;
        });
      },
    });

    const first = resource.refresh();
    const second = resource.refresh();
    expect(first).toBe(second);
    expect(resource.snapshot()).toEqual({ status: "loading", value: "retained" });
    expect(attempts).toBe(1);

    resolve("fresh");
    await first;
    expect(resource.snapshot()).toEqual({ status: "ready", value: "fresh" });
  });
});

async function waitForReady<T>(resource: ReloadableResource<T>): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (resource.snapshot().status === "ready") return;
    await Promise.resolve();
  }
  throw new Error("resource did not become ready");
}
