import type { ActionDescriptor } from "../../../data/forgeActionCatalog";

/** One merge method the plugin offers. */
export type MergeOption = { readonly label: string; readonly value: string };

const NO_OPTIONS: readonly MergeOption[] = [];

/** Merge methods of the merge action's enum input, in plugin order. */
export function mergeOptions(action: ActionDescriptor | undefined): readonly MergeOption[] {
  return action?.input?.type === "enum" ? action.input.options : NO_OPTIONS;
}
