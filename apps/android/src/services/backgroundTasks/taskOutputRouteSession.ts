import type { BackgroundTaskOutputPage } from "../../data/backgroundTaskOutput";
import { RouteSessionRegistry, ROUTE_SESSION_TTL_MS } from "../routeSessionPolicy";
import { sameRouteSessionOwner, type V1RouteSessionOwner } from "../threads/threadRouteParams";

const MAX_TASK_OUTPUT_SESSIONS = 4;

/** One background task's output screen: the task, its first page and its reader. */
export type TaskOutputRouteRequest = {
  readonly first: BackgroundTaskOutputPage;
  readonly name: string;
  readonly read: (taskId: string, offset: number) => Promise<BackgroundTaskOutputPage>;
  readonly taskId: string;
};

/** One retained task output request addressed by an opaque route identifier. */
type TaskOutputRouteSession = {
  readonly id: string;
  readonly owner: V1RouteSessionOwner;
  readonly request: TaskOutputRouteRequest;
  touchedAt: number;
};

/** Retains a task output request behind a bounded opaque route id, out of the URL. */
class TaskOutputRouteSessionService {
  readonly #sessions = new RouteSessionRegistry<TaskOutputRouteSession>({
    limit: MAX_TASK_OUTPUT_SESSIONS,
    ttlMs: ROUTE_SESSION_TTL_MS,
  });

  open(owner: V1RouteSessionOwner, request: TaskOutputRouteRequest): TaskOutputRouteSession {
    const session = {
      id: `task-output-${globalThis.crypto.randomUUID()}`,
      owner,
      request,
      touchedAt: Date.now(),
    };
    this.#sessions.admit(session);
    return session;
  }

  get(id: string, owner: V1RouteSessionOwner): TaskOutputRouteSession | null {
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

export const taskOutputRouteSessions = new TaskOutputRouteSessionService();
