import { DEFAULT_UI_GENERATION, parseUiGeneration, type UiGeneration } from "./uiGeneration";

const KEY = "codewide.ui-generation";

export async function readUiGeneration(): Promise<UiGeneration> {
  return parseUiGeneration(globalThis.localStorage?.getItem(KEY)) ?? DEFAULT_UI_GENERATION;
}

export async function writeUiGeneration(generation: UiGeneration): Promise<void> {
  globalThis.localStorage?.setItem(KEY, generation);
}
