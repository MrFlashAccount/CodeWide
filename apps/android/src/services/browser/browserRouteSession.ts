import { RouteSessionRegistry, ROUTE_SESSION_TTL_MS } from "../routeSessionPolicy";
import { sameRouteSessionOwner, type V1RouteSessionOwner } from "../threads/threadRouteParams";

const MAX_BROWSER_SESSIONS = 4;

/** Bounded browser destination retained outside route parameters. */
type BrowserRouteSession = {
  readonly id: string;
  readonly owner: V1RouteSessionOwner;
  readonly title: string;
  touchedAt: number;
  readonly url: string;
};

/** Retains secret-bearing forwarded URLs behind bounded opaque route identifiers. */
class BrowserRouteSessionService {
  readonly #sessions = new RouteSessionRegistry<BrowserRouteSession>({
    limit: MAX_BROWSER_SESSIONS,
    ttlMs: ROUTE_SESSION_TTL_MS,
  });

  open(owner: V1RouteSessionOwner, title: string, url: string): BrowserRouteSession {
    const session = {
      id: `browser-${globalThis.crypto.randomUUID()}`,
      owner,
      title,
      touchedAt: Date.now(),
      url,
    };
    this.#sessions.admit(session);
    return session;
  }

  get(id: string, owner: V1RouteSessionOwner): BrowserRouteSession | null {
    const session = this.#sessions.get(id);
    return session !== null && sameRouteSessionOwner(session.owner, owner) ? session : null;
  }

  retain(id: string, owner: V1RouteSessionOwner): () => void {
    return this.get(id, owner) === null ? () => undefined : this.#sessions.retain(id);
  }

  close(id: string): void {
    this.#sessions.close(id);
  }
}

export const browserRouteSessions = new BrowserRouteSessionService();
