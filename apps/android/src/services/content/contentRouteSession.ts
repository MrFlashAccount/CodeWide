import type { RenderContentReference } from "@codewide/renderers";
import { RouteSessionRegistry, ROUTE_SESSION_TTL_MS } from "../routeSessionPolicy";
import { sameRouteSessionOwner, type V1RouteSessionOwner } from "../threads/threadRouteParams";

const MAX_CONTENT_SESSIONS = 4;

export type LargeContentRouteRequest = {
  readonly getTransferAccess: (forceRefresh?: boolean) => Promise<{
    readonly authorization: string;
    readonly baseUrl: string;
  }>;
  readonly pointer: string;
  readonly presentation: "markdown" | "terminal" | "text";
  readonly reference: RenderContentReference;
};

/** One retained large-content request addressed by an opaque route identifier. */
type ContentRouteSession = {
  readonly id: string;
  readonly owner: V1RouteSessionOwner;
  readonly request: LargeContentRouteRequest;
  touchedAt: number;
};

/** Retains one private large-content request behind a bounded opaque route id. */
class ContentRouteSessionService {
  readonly #sessions = new RouteSessionRegistry<ContentRouteSession>({
    limit: MAX_CONTENT_SESSIONS,
    ttlMs: ROUTE_SESSION_TTL_MS,
  });

  open(owner: V1RouteSessionOwner, request: LargeContentRouteRequest): ContentRouteSession {
    const session = {
      id: `content-${globalThis.crypto.randomUUID()}`,
      owner,
      request,
      touchedAt: Date.now(),
    };
    this.#sessions.admit(session);
    return session;
  }

  get(id: string, owner: V1RouteSessionOwner): ContentRouteSession | null {
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

export const contentRouteSessions = new ContentRouteSessionService();
