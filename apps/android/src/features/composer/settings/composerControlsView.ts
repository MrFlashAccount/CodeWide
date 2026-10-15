import type { ProjectedThreadExecutionSettings } from "@codewide/sync-client";
import type { ThreadAgent } from "../../../data/threadAgent";
import type { TurnControlsModel, TurnControlsValue } from "../../../data/turn-controls-types";
import { clampModelEffort } from "../../../ui/modelEffort";
import type { PermissionDefaultOption } from "../../../ui/TurnControlMenus.types";
import {
  serverControlValue,
  shownOverlayEntry,
  type ComposerControlField,
  type ComposerControlsOverlay,
} from "./controlsOverlay";
import {
  newChatPermissionDefaultScope,
  resolvedDefaultPermissions,
  threadPermissionDefaultScope,
} from "./permissionDefault";

/** One displayed control value. */
type ComposerControlState<Value> = {
  /** A local choice the server has not answered yet. */
  readonly pending: boolean;
  readonly value: Value;
};

/** What the access chip shows. */
export type ComposerPermissionsDisplay =
  /** An explicit profile: the thread's effective one, a pending choice or a new chat's choice. */
  | { readonly id: string; readonly kind: "profile" }
  /** A new chat without a choice: the provider default, `null` while unknown. */
  | { readonly kind: "default"; readonly resolved: string | null }
  /** An existing thread whose server reports legacy sandbox/approval fields only, or nothing yet. */
  | { readonly kind: "legacy" };

/** The model, thinking, Fast and access values the composer shows for one conversation. */
export type ComposerControlsView = {
  readonly effort: ComposerControlState<string | null>;
  readonly model: ComposerControlState<string | null>;
  /** The catalog row of `model.value`, when the catalog lists it. */
  readonly modelEntry: TurnControlsModel | undefined;
  readonly permissionDefault: PermissionDefaultOption;
  readonly permissions: ComposerControlState<ComposerPermissionsDisplay>;
  readonly serviceTier: ComposerControlState<string | null>;
};

/** The new chat's persisted local choices. */
export type ComposerControlsDraft = {
  readonly effort: string | null;
  readonly model: string | null;
  readonly permissions: string | null;
  readonly serviceTier: string | null | undefined;
};

/** Inputs of an existing thread's controls. */
export type ExistingThreadControlsInput = {
  readonly agent: ThreadAgent | null;
  readonly controls: TurnControlsValue;
  readonly overlay: ComposerControlsOverlay;
  readonly server: ProjectedThreadExecutionSettings | null;
};

const SETTLED = { pending: false } as const;

function existingThreadValue(
  input: ExistingThreadControlsInput,
  field: ComposerControlField,
): ComposerControlState<string | null> {
  const server = serverControlValue(input.server, field);
  const shown = shownOverlayEntry(input.overlay[field], input.server, field);
  if (shown === null) {
    return { ...SETTLED, value: server };
  }
  return {
    pending: shown.status === "sending" && shown.value !== server,
    value: shown.value,
  };
}

function profileDisplay(
  state: ComposerControlState<string | null>,
): ComposerControlState<ComposerPermissionsDisplay> {
  return {
    pending: state.pending,
    value: state.value === null ? { kind: "legacy" } : { id: state.value, kind: "profile" },
  };
}

function resetPermissionDefault(resolved: string | null): PermissionDefaultOption {
  return resolved === null ? { kind: "unavailable" } : { kind: "reset", resolved };
}

/** A model without thinking levels shows none, whatever the server keeps. */
function effortOfModel(
  effort: ComposerControlState<string | null>,
  model: TurnControlsModel | undefined,
): ComposerControlState<string | null> {
  return model?.defaultEffort === null ? { ...effort, value: null } : effort;
}

/** An unknown server tier (older servers) reads as the configured default. */
function existingServiceTier(
  input: ExistingThreadControlsInput,
  model: TurnControlsModel | undefined,
): ComposerControlState<string | null> {
  const tier = existingThreadValue(input, "serviceTier");
  return input.server?.serviceTier === undefined && tier.value === null
    ? { ...tier, value: configuredServiceTier(input.controls, model) }
    : tier;
}

function configuredServiceTier(
  controls: TurnControlsValue,
  model: TurnControlsModel | undefined,
): string | null {
  return controls.defaults.serviceTier ?? model?.defaultServiceTier ?? null;
}

/** Controls of an existing thread: the server's settings with the pending local overlay. */
export function existingThreadControlsView(
  input: ExistingThreadControlsInput,
): ComposerControlsView {
  const model = existingThreadValue(input, "model");
  const modelEntry = input.controls.models.find((candidate) => candidate.id === model.value);
  return {
    effort: effortOfModel(existingThreadValue(input, "effort"), modelEntry),
    model,
    modelEntry,
    permissionDefault: resetPermissionDefault(
      resolvedDefaultPermissions(input.controls, threadPermissionDefaultScope(input.agent)),
    ),
    permissions: profileDisplay(existingThreadValue(input, "permissions")),
    serviceTier: existingServiceTier(input, modelEntry),
  };
}

function newChatModel(controls: TurnControlsValue, draft: ComposerControlsDraft): string | null {
  return (
    draft.model ??
    controls.defaults.model ??
    controls.models.find((candidate) => candidate.isDefault)?.id ??
    null
  );
}

/** The chosen or configured thinking level, kept only when the model offers it. */
function newChatEffort(
  controls: TurnControlsValue,
  draft: ComposerControlsDraft,
  model: TurnControlsModel | undefined,
): string | null {
  const requested = draft.effort ?? (draft.model === null ? controls.defaults.effort : null);
  return model === undefined ? requested : clampModelEffort(model, requested);
}

function newChatPermissions(
  permissions: string | null,
  resolvedDefault: string | null,
): ComposerPermissionsDisplay {
  return permissions === null
    ? { kind: "default", resolved: resolvedDefault }
    : { id: permissions, kind: "profile" };
}

/** Controls of a new chat: its local choices over the catalog defaults. */
export function newChatControlsView(
  controls: TurnControlsValue,
  draft: ComposerControlsDraft,
): ComposerControlsView {
  const model = newChatModel(controls, draft);
  const modelEntry = controls.models.find((candidate) => candidate.id === model);
  const resolvedDefault = resolvedDefaultPermissions(
    controls,
    newChatPermissionDefaultScope(controls, model),
  );
  return {
    effort: { ...SETTLED, value: newChatEffort(controls, draft, modelEntry) },
    model: { ...SETTLED, value: model },
    modelEntry,
    permissionDefault: {
      kind: "draft",
      resolved: resolvedDefault,
      selected: draft.permissions === null,
    },
    permissions: { ...SETTLED, value: newChatPermissions(draft.permissions, resolvedDefault) },
    serviceTier: {
      ...SETTLED,
      value:
        draft.serviceTier === undefined
          ? configuredServiceTier(controls, modelEntry)
          : draft.serviceTier,
    },
  };
}

/** The profile id the access menu marks as selected, `null` for "Server default". */
export function selectedPermissionProfile(display: ComposerPermissionsDisplay): string | null {
  return display.kind === "profile" ? display.id : null;
}
