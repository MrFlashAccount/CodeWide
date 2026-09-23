import { describe, expect, it } from "vitest";

import {
  loadTurnControlsIncrementally,
  turnControlsCacheNeedsRepair,
} from "../src/data/turn-controls-loader";
import type { TurnControlsValue } from "../src/data/turn-controls-types";

const empty: TurnControlsValue = {
  models: [],
  skills: [],
  permissions: [],
  defaults: { model: null, effort: null, permissions: null, serviceTier: null },
};

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
  it("repairs incomplete caches without expiring a usable value by age", () => {
    const cached = {
      status: "ready" as const,
      value: empty,
      error: "Some controls are unavailable",
      updatedAt: 1_000,
    };

    expect(turnControlsCacheNeedsRepair(cached)).toBe(true);
    expect(
      turnControlsCacheNeedsRepair({ ...cached, error: null, updatedAt: Number.MIN_SAFE_INTEGER }),
    ).toBe(false);
  });

  it("refreshes a model catalog cached before service tier support", () => {
    const oldCatalog: TurnControlsValue = {
      ...empty,
      models: [{ id: "sol", label: "Sol", defaultEffort: "high", efforts: ["high"], supportsPersonality: false, isDefault: true }],
    };
    expect(turnControlsCacheNeedsRepair({ status: "ready", error: null, value: oldCatalog })).toBe(true);
    const cachedModel = oldCatalog.models[0];
    if (cachedModel === undefined) { throw new Error("Model fixture is absent"); }
    cachedModel.serviceTiers = [{ id: "priority", name: "Fast", description: "" }];
    expect(turnControlsCacheNeedsRepair({ status: "ready", error: null, value: oldCatalog })).toBe(false);
  });

  it("refreshes cached defaults that predate service tier settings", () => {
    const oldDefaults: TurnControlsValue = {
      ...empty,
      defaults: { model: null, effort: null, permissions: null },
    };
    expect(turnControlsCacheNeedsRepair({ status: "ready", error: null, value: oldDefaults })).toBe(true);
  });

  it("publishes a fast section without waiting for slower catalogs", async () => {
    const models = deferred<TurnControlsValue["models"]>();
    const skills = deferred<TurnControlsValue["skills"]>();
    const permissions = deferred<TurnControlsValue["permissions"]>();
    const defaults = deferred<TurnControlsValue["defaults"]>();
    const partials: Array<{ section: string; value: TurnControlsValue }> = [];
    const firstPartial = deferred<void>();
    const resultPromise = loadTurnControlsIncrementally(
      empty,
      {
        models: () => models.promise,
        skills: () => skills.promise,
        permissions: () => permissions.promise,
        defaults: () => defaults.promise,
      },
      (value, section) => {
        partials.push({ section, value });
        firstPartial.resolve();
      },
      1_000,
    );

    models.resolve([{ id: "gpt", label: "GPT", defaultEffort: "high", efforts: ["high"], supportsPersonality: true, isDefault: true }]);
    await firstPartial.promise;

    expect(partials).toHaveLength(1);
    expect(partials[0]?.section).toBe("models");
    expect(partials[0]?.value.models[0]?.id).toBe("gpt");

    skills.resolve([{ name: "docs", path: "/docs", description: "Docs", enabled: true }]);
    permissions.resolve([{ id: ":workspace", description: null, allowed: true }]);
    defaults.resolve({ model: "gpt", effort: "high", permissions: ":workspace" });
    const result = await resultPromise;
    expect(result.loadedSections).toBe(4);
    expect(result.errors).toEqual([]);
  });

  it("keeps cached sections when one refresh fails", async () => {
    const cached: TurnControlsValue = {
      models: [{ id: "cached", label: "Cached", defaultEffort: "medium", efforts: ["medium"], supportsPersonality: false, isDefault: true }],
      skills: [],
      permissions: [{ id: ":read-only", description: null, allowed: true }],
      defaults: { model: "cached", effort: "medium", permissions: ":read-only" },
    };
    const result = await loadTurnControlsIncrementally(
      cached,
      {
        models: async () => { throw new Error("offline"); },
        skills: async () => [{ name: "fresh", path: "/fresh", description: "Fresh", enabled: true }],
        permissions: async () => cached.permissions,
        defaults: async () => cached.defaults,
      },
      () => undefined,
      1_000,
    );

    expect(result.loadedSections).toBe(3);
    expect(result.value.models[0]?.id).toBe("cached");
    expect(result.value.skills[0]?.name).toBe("fresh");
    expect(result.errors[0]?.message).toBe("offline");
  });

  it("refreshes only the catalogs requested by an opened control", async () => {
    const models = async () => empty.models;
    const skills = async () => empty.skills;
    const permissions = async () => empty.permissions;
    const defaults = async () => empty.defaults;
    const calls: string[] = [];
    await loadTurnControlsIncrementally(
      empty,
      {
        defaults: async () => {
          calls.push("defaults");
          return defaults();
        },
        models: async () => {
          calls.push("models");
          return models();
        },
        permissions: async () => {
          calls.push("permissions");
          return permissions();
        },
        skills: async () => {
          calls.push("skills");
          return skills();
        },
      },
      () => undefined,
      1_000,
      ["models", "defaults"],
    );

    expect(calls).toEqual(["models", "defaults"]);
  });
});
