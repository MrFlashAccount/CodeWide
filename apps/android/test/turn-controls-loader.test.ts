import { describe, expect, it } from "vitest";

import { loadTurnControlsIncrementally } from "../src/data/turn-controls-loader";
import type { TurnControlsValue } from "../src/data/turn-controls-types";

const empty: TurnControlsValue = { models: [], skills: [], permissions: [] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("turn controls loader", () => {
  it("publishes a fast section without waiting for slower catalogs", async () => {
    const models = deferred<TurnControlsValue["models"]>();
    const skills = deferred<TurnControlsValue["skills"]>();
    const permissions = deferred<TurnControlsValue["permissions"]>();
    const partials: Array<{ section: string; value: TurnControlsValue }> = [];
    const firstPartial = deferred<void>();
    const resultPromise = loadTurnControlsIncrementally(
      empty,
      {
        models: () => models.promise,
        skills: () => skills.promise,
        permissions: () => permissions.promise,
      },
      (value, section) => {
        partials.push({ section, value });
        firstPartial.resolve();
      },
      1_000,
    );

    models.resolve([{ id: "gpt", label: "GPT", defaultEffort: "high", efforts: ["high"], supportsPersonality: true }]);
    await firstPartial.promise;

    expect(partials).toHaveLength(1);
    expect(partials[0]?.section).toBe("models");
    expect(partials[0]?.value.models[0]?.id).toBe("gpt");

    skills.resolve([{ name: "docs", path: "/docs", description: "Docs", enabled: true }]);
    permissions.resolve([{ id: ":workspace", description: null, allowed: true }]);
    const result = await resultPromise;
    expect(result.loadedSections).toBe(3);
    expect(result.errors).toEqual([]);
  });

  it("keeps cached sections when one refresh fails", async () => {
    const cached: TurnControlsValue = {
      models: [{ id: "cached", label: "Cached", defaultEffort: "medium", efforts: ["medium"], supportsPersonality: false }],
      skills: [],
      permissions: [{ id: ":read-only", description: null, allowed: true }],
    };
    const result = await loadTurnControlsIncrementally(
      cached,
      {
        models: async () => { throw new Error("offline"); },
        skills: async () => [{ name: "fresh", path: "/fresh", description: "Fresh", enabled: true }],
        permissions: async () => cached.permissions,
      },
      () => undefined,
      1_000,
    );

    expect(result.loadedSections).toBe(2);
    expect(result.value.models[0]?.id).toBe("cached");
    expect(result.value.skills[0]?.name).toBe("fresh");
    expect(result.errors[0]?.message).toBe("offline");
  });
});
