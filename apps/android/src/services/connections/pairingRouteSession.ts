import { PAIRING_ROUTE_SESSION_TTL_MS, RouteSessionRegistry } from "../routeSessionPolicy";

const MAX_PAIRING_SESSIONS = 2;

/** Secret-bearing pairing input retained outside route parameters. */
export type PairingRouteSession = {
  readonly id: string;
  readonly initialCode: string;
  readonly openedAt: number;
  touchedAt: number;
};

/** Keeps a secret-bearing pairing link behind a short-lived opaque route id. */
export class PairingRouteSessionService {
  readonly #sessions = new RouteSessionRegistry<PairingRouteSession>({
    limit: MAX_PAIRING_SESSIONS,
    touchOnGet: false,
    ttlMs: PAIRING_ROUTE_SESSION_TTL_MS,
  });

  open(initialCode: string): PairingRouteSession {
    const openedAt = Date.now();
    const session = {
      id: `pairing-${globalThis.crypto.randomUUID()}`,
      initialCode,
      openedAt,
      touchedAt: openedAt,
    };
    this.#sessions.admit(session);
    return session;
  }

  get(id: string | undefined): PairingRouteSession | null {
    if (id === undefined) {
      return null;
    }
    return this.#sessions.get(id);
  }

  close(id: string | undefined): void {
    if (id !== undefined) {
      this.#sessions.close(id);
    }
  }
}

export const pairingRouteSessions = new PairingRouteSessionService();
