import type { DocumentPreviewRequest } from "../../rendering/DocumentPreviewHost";
import { RouteSessionRegistry, ROUTE_SESSION_TTL_MS } from "../routeSessionPolicy";
import { sameRouteSessionOwner, type V1RouteSessionOwner } from "../threads/threadRouteParams";

const MAX_DOCUMENT_SESSIONS = 8;

type DocumentRouteSession = {
  readonly id: string;
  readonly owner: V1RouteSessionOwner;
  readonly request: DocumentPreviewRequest;
  touchedAt: number;
};

/** Retains document paths, private sources, and transfer access outside navigation state. */
class DocumentRouteService {
  readonly #sessions = new RouteSessionRegistry<DocumentRouteSession>({
    limit: MAX_DOCUMENT_SESSIONS,
    ttlMs: ROUTE_SESSION_TTL_MS,
  });

  open(owner: V1RouteSessionOwner, request: DocumentPreviewRequest): DocumentRouteSession {
    const session = {
      id: `document-${globalThis.crypto.randomUUID()}`,
      owner,
      request,
      touchedAt: Date.now(),
    };
    this.#sessions.admit(session);
    return session;
  }

  get(id: string, owner: V1RouteSessionOwner): DocumentRouteSession | null {
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

/** Shared bounded registry for route-owned document previews. */
export const documentRouteService = new DocumentRouteService();
