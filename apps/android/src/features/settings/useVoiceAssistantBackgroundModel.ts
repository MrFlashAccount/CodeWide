import { clampModelEffort } from "../../ui/modelEffort";
import { useLiveQuery } from "@tanstack/react-db";

import { getUserPreferencesDatabase } from "../../data/user-preferences-database";
import {
  decodeVoiceAssistantBackgroundModelPreference,
  displayedVoiceAssistantBackgroundModel,
  encodeVoiceAssistantBackgroundModelPreference,
  parseVoiceAssistantBackgroundEffort,
  parseVoiceAssistantBackgroundModelId,
  VOICE_ASSISTANT_BACKGROUND_MODEL_PREFERENCE_ID,
  type VoiceAssistantBackgroundModelId,
  type VoiceAssistantBackgroundEffort,
  type VoiceAssistantBackgroundModelPreference,
} from "../../data/voiceAssistantBackgroundModel";
import type { TurnControlsValue } from "../../data/turn-controls-types";
import type { VoiceAssistantModelCatalogSnapshot } from "../../data/voiceAssistantModelCatalog";
import { useEvent } from "../../react/useEvent";

const database = getUserPreferencesDatabase();

function selectedBackgroundModelDisplay(
  preference: VoiceAssistantBackgroundModelPreference,
  catalog: VoiceAssistantModelCatalogSnapshot,
): {
  readonly effort: VoiceAssistantBackgroundEffort | null;
  readonly model: VoiceAssistantBackgroundModelId | null;
} {
  const displayed = displayedVoiceAssistantBackgroundModel(preference, catalog.models);
  if (displayed !== null) {
    return displayed;
  }
  if (preference.status === "serverDefault") {
    return { effort: null, model: null };
  }
  return {
    effort: preference.status === "selected" ? preference.effort : null,
    model: preference.model,
  };
}

function validatedBackgroundModelSettings(
  settings: { readonly effort: string; readonly model: string },
  models: readonly TurnControlsValue["models"][number][],
): {
  readonly effort: VoiceAssistantBackgroundEffort;
  readonly model: VoiceAssistantBackgroundModelId;
} {
  const model = parseVoiceAssistantBackgroundModelId(settings.model);
  const effort = parseVoiceAssistantBackgroundEffort(settings.effort);
  const available = models.find((candidate) => candidate.id === model);
  if (
    model === null ||
    effort === null ||
    available === undefined ||
    clampModelEffort(available, effort) !== effort
  ) {
    throw new Error("The selected Voice Assistant model is unavailable");
  }
  return { effort, model };
}

/** Reads the independent background-thread model preference and resolves catalog fallback. */
export function useVoiceAssistantBackgroundModel(catalog: VoiceAssistantModelCatalogSnapshot): {
  readonly selectedEffort: VoiceAssistantBackgroundEffort | null;
  readonly selectedModel: VoiceAssistantBackgroundModelId | null;
  readonly selectModelSettings: (settings: {
    readonly effort: string;
    readonly model: string;
  }) => Promise<void>;
} {
  const query = useLiveQuery(() => database.collection);
  const row = query.data?.find(
    (candidate) => candidate.id === VOICE_ASSISTANT_BACKGROUND_MODEL_PREFERENCE_ID,
  );
  const preference = decodeVoiceAssistantBackgroundModelPreference(row?.value);
  const displayed = selectedBackgroundModelDisplay(preference, catalog);
  const selectModelSettings = useEvent(
    async (settings: { readonly effort: string; readonly model: string }) => {
      const { effort, model } = validatedBackgroundModelSettings(settings, catalog.models);
      await database.update(VOICE_ASSISTANT_BACKGROUND_MODEL_PREFERENCE_ID, () =>
        encodeVoiceAssistantBackgroundModelPreference({ effort, model, status: "selected" }),
      );
    },
  );
  return {
    selectedEffort: displayed.effort,
    selectedModel: displayed.model,
    selectModelSettings,
  };
}
