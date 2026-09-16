/** V1 disclosureState owner, extracted without changing interaction or resource lifetime. */

export { textFingerprint } from "../../../rendering/listKey";

export const COLLAPSED_BODY_CHARS = 360;

export const persistentExpansionStates = new Map<string, boolean>();

export const PERSISTENT_EXPANSION_STATE_LIMIT = 4096;

export function writePersistentExpansionState(key: string, expanded: boolean): void {
  persistentExpansionStates.delete(key);
  persistentExpansionStates.set(key, expanded);
  while (persistentExpansionStates.size > PERSISTENT_EXPANSION_STATE_LIMIT) {
    const oldest = persistentExpansionStates.keys().next();
    if (oldest.done === true) {
      return;
    }
    persistentExpansionStates.delete(oldest.value);
  }
}
