import type { TurnControlsValue } from "./turn-controls-types";
import { unknownRecord } from "./unknownRecord";

export const VOICE_ASSISTANT_BACKGROUND_MODEL_PREFERENCE_ID = "voice-assistant-background-model";

declare const voiceAssistantBackgroundModelIdBrand: unique symbol;
declare const voiceAssistantBackgroundEffortBrand: unique symbol;

/** Validated model identity selected for the hidden Voice Assistant thread. */
export type VoiceAssistantBackgroundModelId = string & {
  readonly [voiceAssistantBackgroundModelIdBrand]: true;
};

/** Validated reasoning effort selected with the hidden Voice Assistant model. */
export type VoiceAssistantBackgroundEffort = string & {
  readonly [voiceAssistantBackgroundEffortBrand]: true;
};

export type VoiceAssistantBackgroundModelPreference =
  | { readonly status: "serverDefault" }
  | { readonly model: VoiceAssistantBackgroundModelId; readonly status: "legacySelected" }
  | {
      readonly effort: VoiceAssistantBackgroundEffort;
      readonly model: VoiceAssistantBackgroundModelId;
      readonly status: "selected";
    };

export type VoiceAssistantBackgroundModelResolution =
  | { readonly status: "serverDefault" }
  | {
      readonly effort: VoiceAssistantBackgroundEffort;
      readonly model: VoiceAssistantBackgroundModelId;
      readonly status: "selected" | "fallback";
    };

const DEFAULT_VOICE_ASSISTANT_BACKGROUND_MODEL: VoiceAssistantBackgroundModelPreference = {
  status: "serverDefault",
};

const MAX_MODEL_ID_CHARACTERS = 256;
const MAX_EFFORT_CHARACTERS = 32;
const BACKGROUND_MODEL_PREFERENCE_SCHEMA_VERSION = 2;

export function parseVoiceAssistantBackgroundModelId(
  value: unknown,
): VoiceAssistantBackgroundModelId | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_MODEL_ID_CHARACTERS ||
    value.trim() !== value
  ) {
    return null;
  }
  // WHY: Validation above proves the bounded external model identifier; the brand has no runtime representation.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as VoiceAssistantBackgroundModelId;
}

export function parseVoiceAssistantBackgroundEffort(
  value: unknown,
): VoiceAssistantBackgroundEffort | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_EFFORT_CHARACTERS ||
    value.trim() !== value
  ) {
    return null;
  }
  // WHY: Validation above proves the bounded external effort identifier; the brand has no runtime representation.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as VoiceAssistantBackgroundEffort;
}

export function decodeVoiceAssistantBackgroundModelPreference(
  value: string | null | undefined,
): VoiceAssistantBackgroundModelPreference {
  if (typeof value !== "string") {
    return DEFAULT_VOICE_ASSISTANT_BACKGROUND_MODEL;
  }
  try {
    return decodeStoredVoiceAssistantBackgroundModel(JSON.parse(value));
  } catch {
    return DEFAULT_VOICE_ASSISTANT_BACKGROUND_MODEL;
  }
}

function decodeStoredVoiceAssistantBackgroundModel(
  value: unknown,
): VoiceAssistantBackgroundModelPreference {
  const parsed = unknownRecord(value);
  if (parsed === null || parsed.status !== "selected") {
    return DEFAULT_VOICE_ASSISTANT_BACKGROUND_MODEL;
  }
  const model = parseVoiceAssistantBackgroundModelId(parsed.model);
  if (model === null) {
    return DEFAULT_VOICE_ASSISTANT_BACKGROUND_MODEL;
  }
  if (parsed.schemaVersion === 1) {
    return { model, status: "legacySelected" };
  }
  const effort = parseVoiceAssistantBackgroundEffort(parsed.effort);
  return parsed.schemaVersion === BACKGROUND_MODEL_PREFERENCE_SCHEMA_VERSION && effort !== null
    ? { effort, model, status: "selected" }
    : DEFAULT_VOICE_ASSISTANT_BACKGROUND_MODEL;
}

export function encodeVoiceAssistantBackgroundModelPreference(
  preference: Exclude<
    VoiceAssistantBackgroundModelPreference,
    { readonly status: "legacySelected" }
  >,
): string {
  return JSON.stringify({
    schemaVersion: BACKGROUND_MODEL_PREFERENCE_SCHEMA_VERSION,
    ...preference,
  });
}

type AvailableModel = Pick<
  TurnControlsValue["models"][number],
  "defaultEffort" | "efforts" | "id" | "isDefault"
>;

function validatedAvailableModel(model: AvailableModel): {
  readonly defaultEffort: VoiceAssistantBackgroundEffort;
  readonly efforts: readonly string[];
  readonly id: VoiceAssistantBackgroundModelId;
  readonly isDefault: boolean;
} | null {
  const id = parseVoiceAssistantBackgroundModelId(model.id);
  const defaultEffort = parseVoiceAssistantBackgroundEffort(model.defaultEffort);
  return id === null || defaultEffort === null
    ? null
    : { defaultEffort, efforts: model.efforts, id, isDefault: model.isDefault };
}

function defaultAvailableModel(models: readonly AvailableModel[]): {
  readonly effort: VoiceAssistantBackgroundEffort;
  readonly model: VoiceAssistantBackgroundModelId;
} | null {
  for (const model of models) {
    const available = validatedAvailableModel(model);
    if (available !== null && available.isDefault) {
      return { effort: available.defaultEffort, model: available.id };
    }
  }
  return null;
}

function selectedAvailableModel(
  preference: Exclude<
    VoiceAssistantBackgroundModelPreference,
    { readonly status: "serverDefault" }
  >,
  models: readonly AvailableModel[],
): VoiceAssistantBackgroundModelResolution | null {
  for (const model of models) {
    const available = validatedAvailableModel(model);
    if (available?.id !== preference.model) {
      continue;
    }
    if (preference.status === "legacySelected") {
      return { effort: available.defaultEffort, model: available.id, status: "selected" };
    }
    const effortAvailable =
      preference.effort === available.defaultEffort ||
      available.efforts.some(
        (effort) => parseVoiceAssistantBackgroundEffort(effort) === preference.effort,
      );
    return {
      effort: effortAvailable ? preference.effort : available.defaultEffort,
      model: available.id,
      status: effortAvailable ? "selected" : "fallback",
    };
  }
  return null;
}

/** Resolves a persisted selection against the same model catalog used by the composer picker. */
export function resolveVoiceAssistantBackgroundModel(
  preference: VoiceAssistantBackgroundModelPreference,
  models: readonly AvailableModel[],
): VoiceAssistantBackgroundModelResolution {
  if (preference.status === "serverDefault") {
    return { status: "serverDefault" };
  }
  const selected = selectedAvailableModel(preference, models);
  if (selected !== null) {
    return selected;
  }
  const fallback = defaultAvailableModel(models);
  return fallback === null ? { status: "serverDefault" } : { ...fallback, status: "fallback" };
}

export function displayedVoiceAssistantBackgroundModel(
  preference: VoiceAssistantBackgroundModelPreference,
  models: readonly AvailableModel[],
): {
  readonly effort: VoiceAssistantBackgroundEffort;
  readonly model: VoiceAssistantBackgroundModelId;
} | null {
  const resolved = resolveVoiceAssistantBackgroundModel(preference, models);
  if (resolved.status !== "serverDefault") {
    return { effort: resolved.effort, model: resolved.model };
  }
  return defaultAvailableModel(models);
}
