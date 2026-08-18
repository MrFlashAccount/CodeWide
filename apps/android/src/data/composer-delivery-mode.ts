export type ComposerSendPreference = "start" | "queue" | "steer";

export type ResolvedComposerSendMode =
  | { type: "start" }
  | { type: "queue" }
  | { type: "steer"; expectedTurnId: string };

/**
 * `start` is the normal composer preference, not permission to race another
 * turn/start against an active turn. While a turn is active it degrades to the
 * durable queue; steering remains an explicit user choice.
 */
export function resolveComposerSendMode(
  preference: ComposerSendPreference,
  threadActive: boolean,
  activeTurnId: string | null,
): ResolvedComposerSendMode {
  // Queue and steer are relationships to a currently active turn. A persisted
  // preference (or a stale detail turn id) must never keep an idle thread in
  // the companion queue instead of starting the next turn immediately.
  if (!threadActive) return { type: "start" };
  if (preference === "steer" && activeTurnId !== null) {
    return { type: "steer", expectedTurnId: activeTurnId };
  }
  return { type: "queue" };
}

export function effectiveComposerSendPreference(
  preference: ComposerSendPreference,
  threadActive: boolean,
  activeTurnId: string | null,
): ComposerSendPreference {
  return resolveComposerSendMode(preference, threadActive, activeTurnId).type;
}
