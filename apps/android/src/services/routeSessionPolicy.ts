// WHY: Thirty minutes bounds retained private route payloads while allowing normal modal navigation.
// oxlint-disable-next-line eslint/no-magic-numbers
export const ROUTE_SESSION_TTL_MS = 30 * 60 * 1000;

// WHY: Pairing codes expire sooner because they are short-lived authentication material.
// oxlint-disable-next-line eslint/no-magic-numbers
export const PAIRING_ROUTE_SESSION_TTL_MS = 10 * 60 * 1000;

export type RouteSessionEntry = {
  readonly id: string;
  touchedAt: number;
};

type RouteSessionRegistryOptions<Entry extends RouteSessionEntry> = {
  readonly canEvict?: (entry: Entry) => boolean;
  readonly cleanup?: (entry: Entry) => void;
  readonly limit: number;
  readonly touchOnGet?: boolean;
  readonly ttlMs: number;
};

const routeSessionRegistries = new Set<{ disposeAll: () => void }>();
const routeSessionListeners = new Set<() => void>();
let routeSessionVersion = 0;

/** Subscribes React route owners to timer, close, replacement, and workspace retirement. */
export function subscribeRouteSessions(listener: () => void): () => void {
  routeSessionListeners.add(listener);
  return () => {
    routeSessionListeners.delete(listener);
  };
}

/** Returns the monotonic route-session membership version used by React subscriptions. */
export function routeSessionSnapshot(): number {
  return routeSessionVersion;
}

function publishRouteSessionRetirement(): void {
  routeSessionVersion += 1;
  for (const listener of routeSessionListeners) {
    listener();
  }
}

/** Owns deadline, capacity, and exactly-once cleanup for one V1 route-session class. */
export class RouteSessionRegistry<Entry extends RouteSessionEntry> {
  readonly #entries = new Map<string, Entry>();
  readonly #leases = new Map<string, number>();
  readonly #options: RouteSessionRegistryOptions<Entry>;
  #expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: RouteSessionRegistryOptions<Entry>) {
    this.#options = options;
    routeSessionRegistries.add(this);
  }

  admit(entry: Entry): boolean {
    this.#retireExpired();
    while (this.#entries.size >= this.#options.limit) {
      const oldest = this.#oldestEvictable();
      if (oldest === null) {
        if (this.#allEntriesRetained()) {
          break;
        }
        return false;
      }
      this.#retire(oldest);
    }
    this.#entries.set(entry.id, entry);
    this.#scheduleExpiry();
    return true;
  }

  get(id: string): Entry | null {
    this.#retireExpired();
    const entry = this.#entries.get(id) ?? null;
    if (entry !== null && this.#options.touchOnGet !== false) {
      entry.touchedAt = Date.now();
      this.#scheduleExpiry();
    }
    return entry;
  }

  touch(id: string, entry: Entry): void {
    if (this.#entries.get(id) !== entry) {
      return;
    }
    entry.touchedAt = Date.now();
    this.#scheduleExpiry();
  }

  /** Keeps a mounted destination immune to passive expiry and capacity eviction. */
  retain(id: string): () => void {
    const entry = this.#entries.get(id);
    if (entry === undefined) {
      return () => undefined;
    }
    this.#leases.set(id, (this.#leases.get(id) ?? 0) + 1);
    entry.touchedAt = Date.now();
    this.#scheduleExpiry();
    let retained = true;
    return () => {
      if (!retained) {
        return;
      }
      retained = false;
      const leases = this.#leases.get(id);
      if (leases === undefined || leases <= 1) {
        this.#leases.delete(id);
      } else {
        this.#leases.set(id, leases - 1);
      }
      this.#scheduleExpiry();
    };
  }

  close(id: string): void {
    const entry = this.#entries.get(id);
    if (entry !== undefined) {
      this.#retire(entry);
    }
    this.#scheduleExpiry();
  }

  disposeAll(): void {
    for (const entry of this.#entries.values()) {
      this.#retire(entry);
    }
    this.#clearExpiryTimer();
  }

  #canEvict(entry: Entry): boolean {
    return !this.#leases.has(entry.id) && (this.#options.canEvict?.(entry) ?? true);
  }

  #allEntriesRetained(): boolean {
    if (this.#entries.size === 0) {
      return false;
    }
    for (const id of this.#entries.keys()) {
      if (!this.#leases.has(id)) {
        return false;
      }
    }
    return true;
  }

  #oldestEvictable(): Entry | null {
    let oldest: Entry | null = null;
    for (const entry of this.#entries.values()) {
      if (this.#canEvict(entry) && (oldest === null || entry.touchedAt < oldest.touchedAt)) {
        oldest = entry;
      }
    }
    return oldest;
  }

  #retireExpired(): void {
    const cutoff = Date.now() - this.#options.ttlMs;
    for (const entry of this.#entries.values()) {
      if (!this.#leases.has(entry.id) && entry.touchedAt <= cutoff) {
        this.#retire(entry);
      }
    }
    this.#scheduleExpiry();
  }

  #retire(entry: Entry): void {
    if (!this.#entries.delete(entry.id)) {
      return;
    }
    this.#leases.delete(entry.id);
    this.#options.cleanup?.(entry);
    publishRouteSessionRetirement();
  }

  #scheduleExpiry(): void {
    this.#clearExpiryTimer();
    let oldest: Entry | null = null;
    for (const entry of this.#entries.values()) {
      if (!this.#leases.has(entry.id) && (oldest === null || entry.touchedAt < oldest.touchedAt)) {
        oldest = entry;
      }
    }
    if (oldest === null) {
      return;
    }
    const delay = Math.max(0, oldest.touchedAt + this.#options.ttlMs - Date.now());
    this.#expiryTimer = setTimeout(() => {
      this.#expiryTimer = null;
      this.#retireExpired();
    }, delay);
  }

  #clearExpiryTimer(): void {
    if (this.#expiryTimer !== null) {
      clearTimeout(this.#expiryTimer);
      this.#expiryTimer = null;
    }
  }
}

/** Clears every V1 private route-session owner during workspace teardown. */
export function disposeAllRouteSessions(): void {
  for (const registry of routeSessionRegistries) {
    registry.disposeAll();
  }
}
