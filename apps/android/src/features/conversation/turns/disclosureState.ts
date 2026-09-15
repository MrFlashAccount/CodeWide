/** V1 disclosureState owner, extracted without changing interaction or resource lifetime. */

export const COLLAPSED_BODY_CHARS = 360;

export const persistentExpansionStates = new Map<string, boolean>();

export const PERSISTENT_EXPANSION_STATE_LIMIT = 4_096;

export function writePersistentExpansionState(key: string, expanded: boolean): void {
  persistentExpansionStates.delete(key);
  persistentExpansionStates.set(key, expanded);
  while (persistentExpansionStates.size > PERSISTENT_EXPANSION_STATE_LIMIT) {
    const oldest = persistentExpansionStates.keys().next();
    if (oldest.done) return;
    persistentExpansionStates.delete(oldest.value);
  }
}

export function textFingerprint(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${value.length}:${(hash >>> 0).toString(36)}`;
}
