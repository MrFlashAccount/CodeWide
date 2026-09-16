import { RouteSessionRegistry, ROUTE_SESSION_TTL_MS } from "../routeSessionPolicy";
import type { V1RouteSessionOwner } from "../threads/threadRouteParams";

const MAX_DRAWING_SESSIONS = 2;

type DrawingRouteCommit = {
  readonly pngDataUrl: string;
  readonly snapshot: Record<string, unknown>;
};

export type DrawingRouteRequest = {
  readonly commit: (value: DrawingRouteCommit) => Promise<boolean>;
  readonly editing: boolean;
  readonly initialSnapshot: Record<string, unknown> | null;
  readonly mode: "drawing" | "image-annotation";
};

/** One admitted drawing activation retained outside route parameters. */
type DrawingRouteSession = {
  readonly id: string;
  readonly owner: V1RouteSessionOwner;
  readonly request: DrawingRouteRequest;
  status: "ready" | "committing" | "settled";
  touchedAt: number;
};

export type DrawingRouteOpenResult =
  | { readonly session: DrawingRouteSession; readonly status: "admitted" }
  | { readonly status: "capacity" };

/** Owns bounded drawing admission and rejects duplicate or stale completion. */
export class DrawingRouteSessionService {
  readonly #sessions = new RouteSessionRegistry<DrawingRouteSession>({
    canEvict: (session) => session.status !== "committing",
    limit: MAX_DRAWING_SESSIONS,
    ttlMs: ROUTE_SESSION_TTL_MS,
  });

  open(owner: V1RouteSessionOwner, request: DrawingRouteRequest): DrawingRouteOpenResult {
    const session: DrawingRouteSession = {
      id: `drawing-${globalThis.crypto.randomUUID()}`,
      owner,
      request,
      status: "ready",
      touchedAt: Date.now(),
    };
    return this.#sessions.admit(session) ? { session, status: "admitted" } : { status: "capacity" };
  }

  get(id: string): DrawingRouteSession | null {
    return this.#sessions.get(id);
  }

  retain(id: string): () => void {
    return this.get(id) === null ? () => undefined : this.#sessions.retain(id);
  }

  // WHY: Returning the settlement Promise directly prevents a pending commit frame from retaining its expired session request.
  // oxlint-disable-next-line typescript/promise-function-async
  commit(id: string, value: DrawingRouteCommit): Promise<boolean> {
    const session = this.get(id);
    if (session === null || session.status !== "ready") {
      return Promise.resolve(false);
    }
    session.status = "committing";
    try {
      return this.#settleCommit(id, session.request.commit(value));
    } catch (error) {
      session.status = "ready";
      this.#sessions.touch(id, session);
      return Promise.resolve().then(() => {
        throw error;
      });
    }
  }

  async #settleCommit(id: string, pending: Promise<boolean>): Promise<boolean> {
    try {
      const committed = await pending;
      const current = this.get(id);
      if (current === null || current.status !== "committing") {
        return false;
      }
      current.status = committed ? "settled" : "ready";
      this.#sessions.touch(id, current);
      return committed;
    } catch (error) {
      const current = this.get(id);
      if (current !== null && current.status === "committing") {
        current.status = "ready";
        this.#sessions.touch(id, current);
      }
      throw error;
    }
  }

  close(id: string): void {
    this.#sessions.close(id);
  }
}

export const drawingRouteSessions = new DrawingRouteSessionService();
