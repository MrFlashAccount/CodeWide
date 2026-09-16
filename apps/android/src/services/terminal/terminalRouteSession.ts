import { RouteSessionRegistry, ROUTE_SESSION_TTL_MS } from "../routeSessionPolicy";
import { sameRouteSessionOwner, type V1RouteSessionOwner } from "../threads/threadRouteParams";

const MAX_TERMINAL_ROUTE_SESSIONS = 4;

export type TerminalRouteRequest = {
  readonly connectionId: string;
  readonly cwd: string | null;
  readonly threadId: string;
};

/** One retained Terminal destination addressed by an opaque route identifier. */
type TerminalRouteSession = {
  readonly id: string;
  readonly owner: V1RouteSessionOwner;
  readonly request: TerminalRouteRequest;
  touchedAt: number;
};

/** Qualifies retained native Terminal tabs without putting child identity in the parent URL. */
class TerminalRouteSessionService {
  readonly #sessions = new RouteSessionRegistry<TerminalRouteSession>({
    limit: MAX_TERMINAL_ROUTE_SESSIONS,
    ttlMs: ROUTE_SESSION_TTL_MS,
  });

  open(owner: V1RouteSessionOwner, request: TerminalRouteRequest): TerminalRouteSession {
    const session = {
      id: `terminal-${globalThis.crypto.randomUUID()}`,
      owner,
      request,
      touchedAt: Date.now(),
    };
    this.#sessions.admit(session);
    return session;
  }

  get(id: string, owner: V1RouteSessionOwner): TerminalRouteSession | null {
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

export const terminalRouteSessions = new TerminalRouteSessionService();
