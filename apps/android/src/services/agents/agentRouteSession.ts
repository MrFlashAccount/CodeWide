import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";

import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { RouteSessionRegistry, ROUTE_SESSION_TTL_MS } from "../routeSessionPolicy";
import { sameRouteSessionOwner, type V1RouteSessionOwner } from "../threads/threadRouteParams";

const MAX_AGENT_SESSIONS = 4;

/** Captured V1 subagent workspace input retained outside serializable route parameters. */
export type AgentRouteRequest = {
  readonly initialThreadId: string | null;
  readonly parentThread: Thread | null;
  readonly parentThreadId: string;
  readonly summaries: readonly StoredThreadSummary[];
};

type AgentRouteSession = {
  readonly id: string;
  readonly owner: V1RouteSessionOwner;
  readonly request: AgentRouteRequest;
  touchedAt: number;
};

/** Preserves the pre-Router V1 activation snapshot behind one bounded opaque route id. */
class AgentRouteSessionService {
  readonly #sessions = new RouteSessionRegistry<AgentRouteSession>({
    limit: MAX_AGENT_SESSIONS,
    ttlMs: ROUTE_SESSION_TTL_MS,
  });

  open(owner: V1RouteSessionOwner, request: AgentRouteRequest): AgentRouteSession {
    const session = {
      id: `agents-${globalThis.crypto.randomUUID()}`,
      owner,
      request,
      touchedAt: Date.now(),
    };
    this.#sessions.admit(session);
    return session;
  }

  get(id: string, owner: V1RouteSessionOwner): AgentRouteSession | null {
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

export const agentRouteSessions = new AgentRouteSessionService();
