import { getItemAsync, setItemAsync } from "expo-secure-store";

import { DEFAULT_UI_GENERATION, parseUiGeneration, type UiGeneration } from "./uiGeneration";

const KEY = "codewide.ui-generation";

export async function readUiGeneration(): Promise<UiGeneration> {
  return parseUiGeneration(await getItemAsync(KEY)) ?? DEFAULT_UI_GENERATION;
}

export async function writeUiGeneration(generation: UiGeneration): Promise<void> {
  await setItemAsync(KEY, generation);
}
