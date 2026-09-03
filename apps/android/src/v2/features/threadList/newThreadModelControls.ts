import type { V2ThreadSettings } from "@codewide/sync-client/v2";

import type { ActionMenuItem } from "../../ui/ActionMenu";
import type { ModelsResult, NewThreadSettingsSelection } from "./newThreadControls";

type Model = ModelsResult["models"][number];
type ThreadEffort = NonNullable<V2ThreadSettings["effort"]>;

export function effectiveNewThreadSettings(
  models: ModelsResult["models"],
  selection: NewThreadSettingsSelection,
): NewThreadSettingsSelection {
  const model = models.find((candidate) => candidate.id === selection.model) ?? models[0];
  if (model === undefined) return selection;
  return {
    approvalPolicy: selection.approvalPolicy,
    effort: compatibleEffort(model, selection.effort),
    model: model.id,
    personality: model.supportsPersonality ? selection.personality : null,
    sandbox: selection.sandbox,
  };
}

export function nextModelSelection(
  id: string,
  models: ModelsResult["models"],
  selection: NewThreadSettingsSelection,
): NewThreadSettingsSelection | null {
  if (id.startsWith("model:")) {
    const model = models.find((candidate) => candidate.id === id.slice("model:".length));
    if (model === undefined) return null;
    return {
      approvalPolicy: selection.approvalPolicy,
      effort: compatibleEffort(model, selection.effort),
      model: model.id,
      personality: model.supportsPersonality ? selection.personality : null,
      sandbox: selection.sandbox,
    };
  }
  if (id.startsWith("effort:")) return nextEffortSelection(id, models, selection);
  if (id.startsWith("personality:")) return nextPersonalitySelection(id, models, selection);
  return null;
}

export function newThreadModelActions(
  models: ModelsResult["models"],
  selection: NewThreadSettingsSelection,
  loading: boolean,
  error: string | null,
): ActionMenuItem[] {
  const selected = models.find((model) => model.id === selection.model) ?? models[0];
  const actions: ActionMenuItem[] = [];
  if (loading && models.length === 0) {
    actions.push({
      disabled: true,
      id: "model:loading",
      label: "Loading from remote server…",
      section: "Model",
    });
  }
  if (error !== null) {
    actions.push({
      destructive: true,
      disabled: true,
      id: "model:error",
      label: error,
      section: "Error",
    });
  }
  if (models.length === 0 && !loading) {
    actions.push({
      disabled: true,
      id: "model:empty",
      label: "No models returned by the server",
      section: "Model",
    });
    return actions;
  }
  for (const model of models) {
    actions.push({
      id: `model:${model.id}`,
      keepOpen: true,
      label: model.label,
      section: "Model",
      selected: model.id === selection.model,
    });
  }
  if (selected === undefined) return actions;
  for (const effort of availableEfforts(selected)) {
    actions.push({
      id: `effort:${effort}`,
      keepOpen: selected.supportsPersonality,
      label: thinkingEffortLabel(effort),
      section: "Thinking level",
      selected: effort === selection.effort,
    });
  }
  if (!selected.supportsPersonality) return actions;
  actions.push({
    id: "personality:default",
    keepOpen: true,
    label: "Server default",
    section: "Personality",
    selected: selection.personality === null,
  });
  for (const personality of ["friendly", "pragmatic", "none"] as const) {
    actions.push({
      id: `personality:${personality}`,
      keepOpen: true,
      label: personalityLabel(personality),
      section: "Personality",
      selected: personality === selection.personality,
    });
  }
  return actions;
}

function nextEffortSelection(
  id: string,
  models: ModelsResult["models"],
  selection: NewThreadSettingsSelection,
): NewThreadSettingsSelection | null {
  if (selection.model === null) return null;
  const effort = id.slice("effort:".length);
  const model = models.find((candidate) => candidate.id === selection.model);
  if (model === undefined || !isThreadEffort(effort) || !availableEfforts(model).includes(effort)) {
    return null;
  }
  return {
    approvalPolicy: selection.approvalPolicy,
    effort,
    model: selection.model,
    personality: selection.personality,
    sandbox: selection.sandbox,
  };
}

function nextPersonalitySelection(
  id: string,
  models: ModelsResult["models"],
  selection: NewThreadSettingsSelection,
): NewThreadSettingsSelection | null {
  const model = models.find((candidate) => candidate.id === selection.model);
  if (model?.supportsPersonality !== true) return null;
  const value = id.slice("personality:".length);
  const personality =
    value === "friendly" || value === "pragmatic" || value === "none" ? value : null;
  if (value !== "default" && personality === null) return null;
  return {
    approvalPolicy: selection.approvalPolicy,
    effort: selection.effort,
    model: selection.model,
    personality,
    sandbox: selection.sandbox,
  };
}

function compatibleEffort(model: Model, current: V2ThreadSettings["effort"]): ThreadEffort | null {
  const efforts = availableEfforts(model);
  if (current !== null && efforts.includes(current)) return current;
  if (isThreadEffort(model.defaultEffort) && efforts.includes(model.defaultEffort)) {
    return model.defaultEffort;
  }
  return efforts[0] ?? null;
}

function availableEfforts(model: Model): ThreadEffort[] {
  if (model.efforts.length > 0) return model.efforts;
  return isThreadEffort(model.defaultEffort) ? [model.defaultEffort] : [];
}

function isThreadEffort(value: string | null): value is ThreadEffort {
  return (
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max" ||
    value === "ultra"
  );
}

function thinkingEffortLabel(effort: ThreadEffort): string {
  if (effort === "xhigh") return "Extra high";
  return `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`;
}

function personalityLabel(personality: NonNullable<V2ThreadSettings["personality"]>): string {
  return `${personality.charAt(0).toUpperCase()}${personality.slice(1)}`;
}
