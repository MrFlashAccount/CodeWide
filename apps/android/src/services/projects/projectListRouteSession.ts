import type { SidebarProject } from "../../features/projects/sidebarProjects";
import { RouteSessionRegistry, ROUTE_SESSION_TTL_MS } from "../routeSessionPolicy";

const MAX_PROJECT_LIST_SESSIONS = 8;

type ProjectListRouteSession = {
  readonly id: string;
  readonly project: SidebarProject;
  touchedAt: number;
};

/** Keeps private project paths out of URLs while the native stack retains each list destination. */
class ProjectListRouteSessionService {
  readonly #sessions = new RouteSessionRegistry<ProjectListRouteSession>({
    limit: MAX_PROJECT_LIST_SESSIONS,
    ttlMs: ROUTE_SESSION_TTL_MS,
  });

  open(project: SidebarProject): ProjectListRouteSession {
    const entry = {
      id: `project-list-${globalThis.crypto.randomUUID()}`,
      project,
      touchedAt: Date.now(),
    };
    this.#sessions.admit(entry);
    return entry;
  }

  get(sessionId: string): ProjectListRouteSession | null {
    return this.#sessions.get(sessionId);
  }

  retain(sessionId: string): () => void {
    return this.#sessions.retain(sessionId);
  }

  close(sessionId: string): void {
    this.#sessions.close(sessionId);
  }
}

/** Process-local route payload owner; workspace teardown retires its registry. */
export const projectListRouteSessions = new ProjectListRouteSessionService();
