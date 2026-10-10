import { describe, expect, it, vi } from "vitest";

import { parseAgentProviderId } from "../src/data/threadAgent";
import {
  createTurnControlsLoader,
  loadTurnControlsIncrementally,
  turnControlsCacheNeedsRepair,
} from "../src/data/turn-controls-loader";
import { turnControlsResourceKey } from "../src/data/workspace-resource-keys";
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
      models: [{ id: "sol", label: "Sol", defaultEffort: "high", efforts: ["high"], supportsPersonality: false, isDefault: true, provider: null }],
    };
    expect(turnControlsCacheNeedsRepair({ status: "ready", error: null, value: oldCatalog })).toBe(true);
    const cachedModel = oldCatalog.models[0];
    if (cachedModel === undefined) { throw new Error("Model fixture is absent"); }
    cachedModel.serviceTiers = [{ id: "priority", name: "Fast", description: "" }];
    expect(turnControlsCacheNeedsRepair({ status: "ready", error: null, value: oldCatalog })).toBe(false);
  });

  it("refreshes a catalog cached before provider annotations", () => {
    const model = { id: "sol", label: "Sol", defaultEffort: "high", efforts: ["high"], supportsPersonality: false, isDefault: true, serviceTiers: [] };
    const annotated: TurnControlsValue = { ...empty, models: [{ ...model, provider: null }] };
    expect(turnControlsCacheNeedsRepair({ status: "ready", error: null, value: annotated })).toBe(false);
    // WHY: simulates a catalog persisted by an earlier client version, which lacks the provider field.
    const persisted = { ...empty, models: [model] } as unknown as TurnControlsValue;
    expect(turnControlsCacheNeedsRepair({ status: "ready", error: null, value: persisted })).toBe(true);
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

describe("merged catalog with an unavailable provider", () => {
  type Row = Omit<import("../src/data/turn-controls-types").TurnControlsRow, "updatedAt">;
  function modelRow(id: string, provider: string, isDefault = false) {
    return {
      id,
      model: id,
      displayName: id,
      isDefault,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: [{ reasoningEffort: "high" }],
      serviceTiers: [],
      supportsPersonality: false,
      codewideAgentProvider: provider,
    };
  }

  it("keeps the provider's cached rows and refreshes again until it answers", async () => {
    const rows = new Map<string, Row>();
    const cachedModel = (id: string, provider: string, isDefault: boolean) => ({
      defaultEffort: "high",
      defaultServiceTier: null,
      efforts: ["high"],
      id,
      isDefault,
      label: id,
      provider: parseAgentProviderId(provider),
      serviceTiers: [],
      supportsPersonality: false,
    });
    rows.set(turnControlsResourceKey("server", "/w"), {
      connectionId: "server",
      cwd: "/w",
      error: null,
      id: turnControlsResourceKey("server", "/w"),
      status: "ready",
      value: {
        ...empty,
        defaults: { ...empty.defaults, serviceTier: null },
        models: [cachedModel("gpt", "codex", true), cachedModel("sonnet", "claude", false)],
      },
    });
    let claudeLive = false;
    const methods: string[] = [];
    const rpcAfterAttach = vi.fn(async (_session: unknown, method: string): Promise<unknown> => {
      methods.push(method);
      switch (method) {
        case "model/list":
          return claudeLive
            ? { data: [modelRow("gpt", "codex", true), modelRow("sonnet", "claude")] }
            : {
                data: [modelRow("gpt", "codex", true)],
                codewideAgentProvidersUnavailable: ["claude"],
              };
        case "permissionProfile/list":
          return { data: [] };
        case "config/read":
          return { config: { model: null, model_reasoning_effort: null, sandbox_mode: null } };
        default:
          return { data: [] };
      }
    });
    const load = createTurnControlsLoader({
      getResources: () => ({
        putTurnControls: (row: Row) => {
          rows.set(row.id, row);
        },
        // WHY: the loader reads only `get` from the live collection.
        turnControls: { get: (key: string) => rows.get(key) } as never,
      }),
      // WHY: the session is passed through to the mocked RPC only.
      getSession: () => ({}) as never,
      // WHY: the mock answers the few catalog methods this test exercises.
      rpcAfterAttach: rpcAfterAttach as never,
    });
    const settle = async () => {
      await load("server", "/w");
      // The cached value is answered at once; the second call joins the background refresh.
      await load("server", "/w");
    };
    await settle();
    const kept = rows.get(turnControlsResourceKey("server", "/w"))?.value?.models ?? [];
    expect(kept.map((model) => [model.id, model.isDefault])).toEqual([
      ["gpt", true],
      ["sonnet", false],
    ]);
    const before = methods.filter((method) => method === "model/list").length;
    claudeLive = true;
    await settle();
    const afterRetry = methods.filter((method) => method === "model/list").length;
    expect(afterRetry).toBeGreaterThan(before);
    await load("server", "/w");
    expect(methods.filter((method) => method === "model/list").length).toBe(afterRetry);
  });
});
