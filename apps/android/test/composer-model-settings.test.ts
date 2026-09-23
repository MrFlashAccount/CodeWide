import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composerModelSettings } from "../src/features/composer/modelSettings";
import type { TurnControlsValue } from "../src/data/turn-controls-types";

const controls: TurnControlsValue = {
  models: [{ id: "gpt-5.6-sol", label: "Sol", defaultEffort: "medium", efforts: ["medium", "high"], supportsPersonality: false, isDefault: true }],
  skills: [], permissions: [],
  defaults: { model: "gpt-5.6-sol", effort: "medium", permissions: null },
};
const draft = { model: "gpt-5.6-sol", effort: "medium" };
const server = { model: "gpt-6-astra", effort: "high", permissions: null, approvalPolicy: null, sandboxPolicy: null };

const ownerSettings = readFileSync(new URL("../src/features/composer/settings.ts", import.meta.url), "utf8");
const ownerSubmission = readFileSync(new URL("../src/features/composer/submission.ts", import.meta.url), "utf8");
const ownerComposerControlOptions = readFileSync(new URL("../src/features/composer/settings/ComposerControlOptions.tsx", import.meta.url), "utf8");

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
    const screen = readFileSync(new URL("../app/(workspace)/_layout.tsx", import.meta.url), "utf8");
    expect(ownerSettings).toContain("const selectedModel = newChat ? composerPreferences.model : null;");
    expect(ownerSettings).toContain("const selectedEffort = newChat ? composerPreferences.effort : null;");
    expect(ownerSubmission).toContain("...(selectedModel === null ? {} : { model: selectedModel })");
    expect(ownerSubmission).toContain("...(selectedEffort === null ? {} : { effort: selectedEffort })");
    expect(screen).not.toContain("latestProjectedThreadExecutionSettings");
    expect(screen).not.toContain("?? controls.models[0]");
    expect(ownerComposerControlOptions).toContain("selected={candidate.id === selectedModel}");
    const nativeMenu = readFileSync(new URL("../src/ui/TurnControlMenus.native.tsx", import.meta.url), "utf8");
    const modelSheet = readFileSync(new URL("../src/ui/ModelThinkingSheet.native.tsx", import.meta.url), "utf8");
    expect(nativeMenu).not.toContain("?? models[0]");
    expect(nativeMenu).toContain("ModelThinkingSheet as ModelThinkingMenu");
    expect(modelSheet).toContain("candidate.id === props.selectedModel");
    expect(modelSheet).not.toContain("?? models[0]");
  });
});
