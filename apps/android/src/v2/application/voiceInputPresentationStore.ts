export type VoiceInputState =
  | "idle"
  | "starting"
  | "recording"
  | "finishing"
  | "cancelling"
  | "retry"
  | "error";

export interface VoiceInputSnapshot {
  message: string | null;
  /** Process-owned capture start, used only to render the frozen V1 elapsed-time label. */
  startedAtMs?: number | null;
  state: VoiceInputState;
}

export const VOICE_INPUT_IDLE_SNAPSHOT: VoiceInputSnapshot = { message: null, state: "idle" };

/** Owns low-frequency Voice state and an isolated high-frequency level channel. */
export class VoiceInputPresentationStore {
  readonly #activeListeners = new Set<() => void>();
  readonly #activeLevelListeners = new Set<() => void>();
  readonly #listeners = new Map<string, Set<() => void>>();
  readonly #levels = new Map<string, number>();
  readonly #levelListeners = new Map<string, Set<() => void>>();
  readonly #snapshots = new Map<string, VoiceInputSnapshot>();
  #activeLevel = 0;
  #activeSnapshot = VOICE_INPUT_IDLE_SNAPSHOT;

  activeSnapshot(): VoiceInputSnapshot {
    return this.#activeSnapshot;
  }

  subscribeActive(listener: () => void): () => void {
    return subscribeToSet(this.#activeListeners, listener);
  }

  activeLevel(): number {
    return this.#activeLevel;
  }

  subscribeActiveLevel(listener: () => void): () => void {
    return subscribeToSet(this.#activeLevelListeners, listener);
  }

  snapshot(key: string): VoiceInputSnapshot {
    return this.#snapshots.get(key) ?? VOICE_INPUT_IDLE_SNAPSHOT;
  }

  subscribe(key: string, listener: () => void): () => void {
    return subscribeTo(this.#listeners, key, listener);
  }

  level(key: string): number {
    return this.#levels.get(key) ?? 0;
  }

  subscribeLevel(key: string, listener: () => void): () => void {
    return subscribeTo(this.#levelListeners, key, listener);
  }

  publishSnapshot(key: string, snapshot: VoiceInputSnapshot): void {
    if (snapshot.state === "idle") this.#snapshots.delete(key);
    else this.#snapshots.set(key, snapshot);
    for (const listener of this.#listeners.get(key) ?? []) listener();
  }

  publishLevel(key: string, rawLevel: number): void {
    const level = boundedLevel(rawLevel);
    if (this.level(key) === level) return;
    if (level === 0) this.#levels.delete(key);
    else this.#levels.set(key, level);
    for (const listener of this.#levelListeners.get(key) ?? []) listener();
  }

  publishActiveSnapshot(snapshot: VoiceInputSnapshot): void {
    if (
      this.#activeSnapshot.state === snapshot.state &&
      this.#activeSnapshot.message === snapshot.message
    )
      return;
    this.#activeSnapshot = snapshot;
    for (const listener of this.#activeListeners) listener();
  }

  publishActiveLevel(rawLevel: number): void {
    const level = boundedLevel(rawLevel);
    if (this.#activeLevel === level) return;
    this.#activeLevel = level;
    for (const listener of this.#activeLevelListeners) listener();
  }
}

function subscribeToSet(subscriptions: Set<() => void>, listener: () => void): () => void {
  subscriptions.add(listener);
  return () => subscriptions.delete(listener);
}

function subscribeTo(
  subscriptions: Map<string, Set<() => void>>,
  key: string,
  listener: () => void,
): () => void {
  const listeners = subscriptions.get(key) ?? new Set<() => void>();
  listeners.add(listener);
  subscriptions.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) subscriptions.delete(key);
  };
}

function boundedLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(1, level));
}
