const FNV_OFFSET_BASIS = 2_166_136_261;
const FNV_PRIME = 16_777_619;
const BASE36_RADIX = 36;

/** Returns a compact deterministic fingerprint suitable for a semantic React key. */
export function textFingerprint(value: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, FNV_PRIME);
  }
  return `${String(value.length)}:${(hash >>> 0).toString(BASE36_RADIX)}`;
}

/** Disambiguates equal semantic identities without coupling a key to list position. */
export function occurrenceKey(occurrences: Map<string, number>, identity: string): string {
  const occurrence = occurrences.get(identity) ?? 0;
  occurrences.set(identity, occurrence + 1);
  return occurrence === 0 ? identity : `${identity}:${String(occurrence)}`;
}
