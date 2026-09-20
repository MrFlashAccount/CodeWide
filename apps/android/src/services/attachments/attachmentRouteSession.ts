import type { DocumentPreviewRequest } from "../../rendering/DocumentPreviewHost";
import { RouteSessionRegistry, ROUTE_SESSION_TTL_MS } from "../routeSessionPolicy";
import { sameRouteSessionOwner, type V1RouteSessionOwner } from "../threads/threadRouteParams";

const MAX_ATTACHMENT_SESSIONS = 6;

/** Capabilities captured from the selected conversation for its attachment destination. */
export type AttachmentRouteRequest = {
  readonly openCodeDocument: (request: DocumentPreviewRequest) => void;
};

type AttachmentRouteSession = {
  readonly id: string;
  readonly owner: V1RouteSessionOwner;
  readonly request: AttachmentRouteRequest;
  touchedAt: number;
};

class AttachmentRouteSessionService {
  readonly #sessions = new RouteSessionRegistry<AttachmentRouteSession>({
    limit: MAX_ATTACHMENT_SESSIONS,
    ttlMs: ROUTE_SESSION_TTL_MS,
  });

  open(owner: V1RouteSessionOwner, request: AttachmentRouteRequest): AttachmentRouteSession {
    const session = {
      id: `attachments-${globalThis.crypto.randomUUID()}`,
      owner,
      request,
      touchedAt: Date.now(),
    };
    this.#sessions.admit(session);
    return session;
  }

  get(id: string, owner: V1RouteSessionOwner): AttachmentRouteSession | null {
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

/** Bounded owner-qualified capabilities for the mounted attachment route. */
export const attachmentRouteSessions = new AttachmentRouteSessionService();
