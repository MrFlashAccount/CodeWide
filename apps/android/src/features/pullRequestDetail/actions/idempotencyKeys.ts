import type { ForgeFailure } from "../../../data/forgeErrors";

/** Idempotency keys per user intent (an action id, or Submit). */
export type IdempotencyKeys = {
  /** The key for the next attempt: the retained one, or a fresh one. */
  readonly keyFor: (intent: string) => string;
  /** Records how an attempt ended; `null` is an acknowledged outcome. */
  readonly settle: (intent: string, failure: ForgeFailure | null) => void;
};

/**
 * Keeps a key only when the request may not have reached the companion
 * (`unreachable`), so a retry cannot apply the write twice. Every answer from
 * the companion retires the key, including `outcomeUnknown`: the companion
 * already journaled that key, so the user refreshes and runs again with a new one.
 */
export function createIdempotencyKeys(newKey: () => string): IdempotencyKeys {
  const retained = new Map<string, string>();
  return {
    keyFor(intent) {
      const key = retained.get(intent) ?? newKey();
      retained.set(intent, key);
      return key;
    },
    settle(intent, failure) {
      if (failure?.kind !== "unreachable") {
        retained.delete(intent);
      }
    },
  };
}
