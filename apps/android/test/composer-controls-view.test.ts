import { readFileSync } from "node:fs";
import type { ProjectedThreadExecutionSettings } from "@codewide/sync-client";
import { describe, expect, it } from "vitest";

import { NativeCommandSettlements } from "../src/data/nativeCommandSettlement";
import type { AgentProviderId, ThreadAgent } from "../src/data/threadAgent";
import type { TurnControlsModel, TurnControlsValue } from "../src/data/turn-controls-types";
import type { NativeCommandDelivery } from "../src/native/native-transport-contract";
import {
  existingThreadControlsView,
  newChatControlsView,
  type ExistingThreadControlsInput,
} from "../src/features/composer/settings/composerControlsView";
import {
  controlBaseline,
  EMPTY_CONTROLS_OVERLAY,
  overlayAccepted,
  overlayRejected,
  overlayWithChanges,
  reconcileControlsState,
  threadSettingsUpdate,
  type ComposerControlChanges,
  type ComposerControlsOverlay,
} from "../src/features/composer/settings/controlsOverlay";
import { clampModelEffort, modelEffortLevels } from "../src/ui/modelEffort";

const codex = "codex" as AgentProviderId;
const claude = "claude" as AgentProviderId;

function model(
  id: string,
  provider: AgentProviderId | null,
  reasoning: Pick<TurnControlsModel, "defaultEffort" | "efforts">,
  isDefault = false,
): TurnControlsModel {
  return {
    ...reasoning,
    defaultServiceTier: null,
    id,
    isDefault,
    label: id,
    provider,
    serviceTiers: [],
    supportsPersonality: false,
  } as TurnControlsModel;
}

const sol = model("sol", codex, { defaultEffort: "medium", efforts: ["medium", "high"] }, true);
const astra = model("astra", codex, { defaultEffort: "high", efforts: ["low", "high"] });
const opus = model("opus", claude, { defaultEffort: "high", efforts: ["low", "high", "max"] });
const haiku = model("haiku", claude, { defaultEffort: null, efforts: [] });

const controls: TurnControlsValue = {
  defaults: { effort: "medium", model: "sol", permissions: ":read-only", serviceTier: null },
  models: [sol, astra, opus, haiku],
  permissions: [],
  skills: [],
};

const codexAgent: ThreadAgent = {
  capabilities: ["threads.fork"],
  primary: true,
  provider: codex,
  providerName: "Codex",
};
const claudeAgent: ThreadAgent = {
  capabilities: ["threads.crossProviderFork"],
  primary: false,
  provider: claude,
  providerName: "Claude",
};

function server(
  settings: Partial<ProjectedThreadExecutionSettings> = {},
): ProjectedThreadExecutionSettings {
  return {
    approvalPolicy: null,
    effort: "high",
    model: "astra",
    permissions: ":workspace",
    sandboxPolicy: null,
    serviceTier: null,
    ...settings,
  };
}

function existing(input: Partial<ExistingThreadControlsInput>) {
  return existingThreadControlsView({
    activeTurnId: null,
    agent: codexAgent,
    controls,
    overlay: EMPTY_CONTROLS_OVERLAY,
    server: server(),
    ...input,
  });
}

function choose(
  overlay: ComposerControlsOverlay,
  changes: ComposerControlChanges,
  current: ProjectedThreadExecutionSettings | null,
  mutation: number,
  activeTurnId: string | null = null,
): ComposerControlsOverlay {
  return overlayWithChanges(overlay, {
    baseline: controlBaseline(current, activeTurnId),
    changes,
    mutation,
  });
}

describe("model thinking levels", () => {
  it("offers the catalog levels, the default alone, or none", () => {
    expect(modelEffortLevels(sol)).toEqual(["medium", "high"]);
    expect(modelEffortLevels({ defaultEffort: "high", efforts: [] })).toEqual(["high"]);
    expect(modelEffortLevels(haiku)).toEqual([]);
  });

  it("keeps a supported effort and otherwise falls back to the model default", () => {
    expect(clampModelEffort(sol, "high")).toBe("high");
    expect(clampModelEffort(sol, "max")).toBe("medium");
    expect(clampModelEffort(sol, null)).toBe("medium");
    expect(clampModelEffort(opus, "max")).toBe("max");
  });

  it("never invents an effort for a model without thinking levels", () => {
    expect(clampModelEffort(haiku, "high")).toBeNull();
    expect(clampModelEffort(haiku, null)).toBeNull();
  });
});

describe("existing thread controls", () => {
  it("shows the server's settings, never a catalog default", () => {
    const view = existing({});
    expect(view.model).toEqual({ nextTurn: false, pending: false, value: "astra" });
    expect(view.effort.value).toBe("high");
    expect(view.permissions.value).toEqual({ id: ":workspace", kind: "profile" });
  });

  it("shows nothing confirmed while the server has reported no settings", () => {
    const view = existing({ server: null });
    expect(view.model.value).toBeNull();
    expect(view.effort.value).toBeNull();
    expect(view.permissions.value).toEqual({ kind: "legacy" });
  });

  it("keeps a server-default effort unset", () => {
    expect(existing({ server: server({ effort: null }) }).effort.value).toBeNull();
  });

  it("hides the effort of a model without thinking levels", () => {
    const view = existing({
      agent: claudeAgent,
      server: server({ effort: "high", model: "haiku" }),
    });
    expect(view.model.value).toBe("haiku");
    expect(view.effort.value).toBeNull();
  });

  it("shows a pending choice until the server echoes it", () => {
    const before = server();
    const overlay = choose(EMPTY_CONTROLS_OVERLAY, { effort: "low", model: "astra" }, before, 1);
    const pending = existing({ overlay, server: before });
    expect(pending.effort).toEqual({ nextTurn: false, pending: true, value: "low" });
    // The model did not change: it is not shown as pending.
    expect(pending.model.pending).toBe(false);

    const echoed = server({ effort: "low" });
    expect(existing({ overlay, server: echoed }).effort).toEqual({
      nextTurn: false,
      pending: false,
      value: "low",
    });
  });

  it("lets any other server change replace a local choice", () => {
    const before = server();
    const overlay = choose(EMPTY_CONTROLS_OVERLAY, { model: "sol" }, before, 1);
    const elsewhere = server({ model: "opus" });
    expect(existing({ overlay, server: elsewhere }).model.value).toBe("opus");
  });

  it("does not resurrect a confirmed choice when the server later reverts it", () => {
    const before = server();
    let state = {
      activeTurnId: null,
      overlay: choose(EMPTY_CONTROLS_OVERLAY, { model: "sol" }, before, 1),
      server: before,
    };
    state = reconcileControlsState(state, server({ model: "sol" }), null);
    state = reconcileControlsState(state, before, null);
    expect(existing({ overlay: state.overlay, server: before }).model.value).toBe("astra");
  });

  it("returns the same state when nothing changed", () => {
    const state = { activeTurnId: null, overlay: EMPTY_CONTROLS_OVERLAY, server: server() };
    expect(reconcileControlsState(state, server(), null)).toBe(state);
  });

  it("reverts a rejected choice and keeps a newer choice of the same field", () => {
    const before = server();
    const first = choose(EMPTY_CONTROLS_OVERLAY, { model: "sol" }, before, 1);
    expect(existing({ overlay: overlayRejected(first, 1), server: before }).model.value).toBe(
      "astra",
    );
    const second = choose(first, { model: "opus" }, before, 2);
    const afterLateRejection = overlayRejected(second, 1);
    expect(existing({ overlay: afterLateRejection, server: before }).model.value).toBe("opus");
  });

  it("stops the shimmer once the server accepts, before the echo arrives", () => {
    const before = server();
    const overlay = overlayAccepted(choose(EMPTY_CONTROLS_OVERLAY, { model: "sol" }, before, 1), 1);
    expect(existing({ overlay, server: before }).model).toEqual({
      nextTurn: false,
      pending: false,
      value: "sol",
    });
  });

  it("marks a model change made during a turn as applying from the next turn", () => {
    const before = server();
    const overlay = choose(EMPTY_CONTROLS_OVERLAY, { model: "sol" }, before, 1, "turn-1");
    const echoed = server({ model: "sol" });
    expect(existing({ activeTurnId: "turn-1", overlay, server: echoed }).model.nextTurn).toBe(true);
    expect(existing({ activeTurnId: "turn-2", overlay, server: echoed }).model.nextTurn).toBe(
      false,
    );
    expect(existing({ activeTurnId: null, overlay, server: echoed }).model.nextTurn).toBe(false);
  });

  it("applies Claude's workspace/full-access switch live and read-only at the next turn", () => {
    const before = server({ model: "opus", permissions: ":workspace" });
    const full = choose(EMPTY_CONTROLS_OVERLAY, { permissions: ":full-access" }, before, 1, "t");
    expect(
      existing({ activeTurnId: "t", agent: claudeAgent, overlay: full, server: before })
        .permissions,
    ).toEqual({ nextTurn: false, pending: true, value: { id: ":full-access", kind: "profile" } });
    const readOnly = choose(EMPTY_CONTROLS_OVERLAY, { permissions: ":read-only" }, before, 2, "t");
    expect(
      existing({ activeTurnId: "t", agent: claudeAgent, overlay: readOnly, server: before })
        .permissions.nextTurn,
    ).toBe(true);
  });

  it("applies every Codex access change at the next turn", () => {
    const before = server();
    const full = choose(EMPTY_CONTROLS_OVERLAY, { permissions: ":full-access" }, before, 1, "t");
    expect(
      existing({ activeTurnId: "t", overlay: full, server: before }).permissions.nextTurn,
    ).toBe(true);
  });
});

describe("server default access", () => {
  it("resets a Codex thread to the configured profile", () => {
    expect(existing({}).permissionDefault).toEqual({ kind: "reset", resolved: ":read-only" });
  });

  it("is unavailable while the Codex configuration names no profile", () => {
    const unknown = { ...controls, defaults: { ...controls.defaults, permissions: null } };
    expect(existing({ controls: unknown }).permissionDefault).toEqual({ kind: "unavailable" });
  });

  it("resets a Claude thread to the Companion's neutral default", () => {
    expect(existing({ agent: claudeAgent }).permissionDefault).toEqual({
      kind: "reset",
      resolved: ":workspace",
    });
  });

  it("treats a legacy thread as the primary provider's", () => {
    expect(existing({ agent: null }).permissionDefault).toEqual({
      kind: "reset",
      resolved: ":read-only",
    });
  });

  it("shows a new chat's default for the chosen model's provider", () => {
    const draft = { effort: null, model: null, permissions: null, serviceTier: undefined };
    expect(newChatControlsView(controls, draft).permissions.value).toEqual({
      kind: "default",
      resolved: ":read-only",
    });
    expect(newChatControlsView(controls, { ...draft, model: "opus" }).permissions.value).toEqual({
      kind: "default",
      resolved: ":workspace",
    });
    expect(
      newChatControlsView(controls, { ...draft, permissions: ":full-access" }).permissionDefault,
    ).toEqual({ kind: "draft", resolved: ":read-only", selected: false });
  });
});

describe("new chat controls", () => {
  const draft = { effort: null, model: null, permissions: null, serviceTier: undefined };

  it("uses the catalog defaults before a choice", () => {
    const view = newChatControlsView(controls, draft);
    expect(view.model.value).toBe("sol");
    expect(view.effort.value).toBe("medium");
  });

  it("keeps the user's choice and clamps an effort the model does not offer", () => {
    expect(
      newChatControlsView(controls, { ...draft, effort: "high", model: "astra" }).effort.value,
    ).toBe("high");
    expect(
      newChatControlsView(controls, { ...draft, effort: "medium", model: "astra" }).effort.value,
    ).toBe("high");
    expect(
      newChatControlsView(controls, { ...draft, effort: "high", model: "haiku" }).effort.value,
    ).toBeNull();
  });
});

describe("settings update", () => {
  it("sends only the chosen fields", () => {
    expect(threadSettingsUpdate({ permissions: ":workspace" })).toEqual({
      permissions: ":workspace",
    });
    expect(threadSettingsUpdate({ model: "sol", serviceTier: null })).toEqual({
      model: "sol",
      serviceTier: null,
    });
  });

  it("does not send local model choices with messages in existing threads", () => {
    const settings = readFileSync(
      new URL("../src/features/composer/settings.ts", import.meta.url),
      "utf8",
    );
    expect(settings).toContain("const selectedModel = newChat ? composerPreferences.model : null;");
    expect(settings).toContain(
      "const selectedEffort = newChat ? composerPreferences.effort : null;",
    );
    expect(settings).toContain(
      "const selectedPermissions = newChat ? composerPreferences.permissions : null;",
    );
  });
});

describe("native command settlement", () => {
  function delivery(state: NativeCommandDelivery["state"], lastError: string | null = null) {
    return {
      attachments: [],
      attempts: 1,
      commandId: "command",
      connectionId: "connection",
      createdAt: 0,
      lastError,
      method: "thread/settings/update",
      state,
      targetCommandId: null,
      text: "",
      threadId: "thread",
      updatedAt: 0,
    } satisfies NativeCommandDelivery;
  }

  it("resolves on delivery and stays pending while queued", async () => {
    const settlements = new NativeCommandSettlements();
    const { settled } = settlements.register("connection", "command");
    let resolved = false;
    void settled.then(() => {
      resolved = true;
    });
    settlements.observe(delivery("queued"));
    settlements.observe(delivery("uncertain", "offline"));
    await Promise.resolve();
    expect(resolved).toBe(false);
    settlements.observe(delivery("delivered"));
    await settled;
    expect(resolved).toBe(true);
  });

  it("rejects with the server's error", async () => {
    const settlements = new NativeCommandSettlements();
    const { settled } = settlements.register("connection", "command");
    settlements.observe(delivery("failed", "Unsupported permission profile for Claude: :custom"));
    await expect(settled).rejects.toThrow("Unsupported permission profile for Claude: :custom");
  });

  it("ignores other commands and cancelled waiters", async () => {
    const settlements = new NativeCommandSettlements();
    const { cancel, settled } = settlements.register("connection", "command");
    settlements.observe({ ...delivery("delivered"), commandId: "other" });
    cancel();
    settlements.observe(delivery("failed", "late"));
    const outcome = await Promise.race([
      settled.then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 10)),
    ]);
    expect(outcome).toBe("pending");
  });
});
