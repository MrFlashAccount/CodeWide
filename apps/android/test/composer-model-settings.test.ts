import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composerModelSettings } from "../src/data/composer-model-settings";
import type { TurnControlsValue } from "../src/data/turn-controls-types";

const controls: TurnControlsValue = {
  models: [{ id: "gpt-5.6-sol", label: "Sol", defaultEffort: "medium", efforts: ["medium", "high"], supportsPersonality: false, isDefault: true }],
  skills: [], permissions: [],
  defaults: { model: "gpt-5.6-sol", effort: "medium", permissions: null },
};
const draft = { model: "gpt-5.6-sol", effort: "medium" };
const server = { model: "gpt-6-astra", effort: "high", permissions: null, approvalPolicy: null, sandboxPolicy: null };

describe("composer model authority", () => {
  it("shows the server model even when the local selection and catalog say Sol", () => {
    expect(composerModelSettings(false, server, draft, controls)).toEqual({ model: "gpt-6-astra", effort: "high" });
  });

  it("shows unknown for an existing thread without server settings", () => {
    expect(composerModelSettings(false, null, draft, controls)).toEqual({ model: null, effort: null });
  });

  it("does not turn a server-default effort into a catalog or local effort", () => {
    expect(composerModelSettings(false, { ...server, effort: null }, draft, controls))
      .toEqual({ model: "gpt-6-astra", effort: null });
  });

  it("retains user choice and catalog defaults before a new thread exists", () => {
    expect(composerModelSettings(true, null, { model: "gpt-6-astra", effort: "high" }, controls))
      .toEqual({ model: "gpt-6-astra", effort: "high" });
    expect(composerModelSettings(true, null, { model: null, effort: null }, controls))
      .toEqual({ model: "gpt-5.6-sol", effort: "medium" });
  });

  it("does not send persisted local model overrides with messages in existing threads", () => {
    const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
    expect(screen).toContain("const selectedModel = newChat ? composerPreferences.model : null;");
    expect(screen).toContain("const selectedEffort = newChat ? composerPreferences.effort : null;");
    expect(screen).toContain("...(selectedModel === null ? {} : { model: selectedModel })");
    expect(screen).toContain("...(selectedEffort === null ? {} : { effort: selectedEffort })");
    expect(screen).not.toContain("latestProjectedThreadExecutionSettings");
    expect(screen).not.toContain("?? controls.models[0]");
    expect(screen).toContain("selected={candidate.id === selectedModel}");
    const nativeMenu = readFileSync(new URL("../src/ui/TurnControlMenus.native.tsx", import.meta.url), "utf8");
    expect(nativeMenu).not.toContain("?? models[0]");
    expect(nativeMenu).toContain("const effectiveModel = selectedModel;");
    expect(nativeMenu).toContain("const effectiveEffort = selectedEffort;");
  });
});
