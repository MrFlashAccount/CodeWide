import type { SearchContextQuery, SearchConversationPage } from "../../data/message-search";
import { SearchConversationWindow } from "../../features/search/search-conversation-window";
import { SearchSession } from "../../features/search/search-session";
import type { LocatedSearchHit } from "../../features/search/GlobalSearchScreen";
import { RouteSessionRegistry, ROUTE_SESSION_TTL_MS } from "../routeSessionPolicy";
import { sameRouteSessionOwner, type V1RouteSessionOwner } from "../threads/threadRouteParams";

const MAX_SEARCH_SESSIONS = 4;

type SearchRouteSession = {
  readonly id: string;
  readonly owner: V1RouteSessionOwner;
  readonly session: SearchSession;
  touchedAt: number;
};

type SearchWindowEntry = {
  readonly id: string;
  readonly owner: V1RouteSessionOwner;
  touchedAt: number;
  readonly window: SearchConversationWindow;
};

type OpenSearchWindowInput = {
  readonly owner: V1RouteSessionOwner;
  readonly query: string;
  readonly searchConversation: (
    connectionId: string,
    input: SearchContextQuery,
  ) => Promise<SearchConversationPage>;
  readonly target: LocatedSearchHit;
};

/** Retains bounded V1 search state and message windows outside route parameters. */
export class SearchRouteSessionService {
  readonly #sessions = new RouteSessionRegistry<SearchRouteSession>({
    cleanup: (entry) => {
      entry.session.cancelPending();
    },
    limit: MAX_SEARCH_SESSIONS,
    ttlMs: ROUTE_SESSION_TTL_MS,
  });
  readonly #windows = new RouteSessionRegistry<SearchWindowEntry>({
    cleanup: (entry) => {
      entry.window.cancelViewportFill();
    },
    limit: MAX_SEARCH_SESSIONS,
    ttlMs: ROUTE_SESSION_TTL_MS,
  });

  open(owner: V1RouteSessionOwner): SearchRouteSession {
    const id = `search-${globalThis.crypto.randomUUID()}`;
    const entry = { id, owner, session: new SearchSession(id), touchedAt: Date.now() };
    this.#sessions.admit(entry);
    entry.session.requestFocus();
    return entry;
  }

  get(sessionId: string, owner: V1RouteSessionOwner): SearchRouteSession | null {
    const entry = this.#sessions.get(sessionId);
    return entry !== null && sameRouteSessionOwner(entry.owner, owner) ? entry : null;
  }

  retain(sessionId: string, owner: V1RouteSessionOwner): () => void {
    return this.get(sessionId, owner) === null ? () => undefined : this.#sessions.retain(sessionId);
  }

  close(sessionId: string): void {
    this.#sessions.close(sessionId);
  }

  openWindow({ owner, query, searchConversation, target }: OpenSearchWindowInput): string | null {
    if (target.hit.kind === "thread") {
      return null;
    }
    const id = `search-window-${globalThis.crypto.randomUUID()}`;
    this.#windows.admit({
      id,
      owner,
      touchedAt: Date.now(),
      window: new SearchConversationWindow(target, query, searchConversation),
    });
    return id;
  }

  window(
    windowId: string | undefined,
    owner: V1RouteSessionOwner,
  ): SearchConversationWindow | null {
    if (windowId === undefined) {
      return null;
    }
    const entry = this.#windows.get(windowId);
    return entry !== null && sameRouteSessionOwner(entry.owner, owner) ? entry.window : null;
  }

  retainWindow(windowId: string, owner: V1RouteSessionOwner): () => void {
    return this.window(windowId, owner) === null ? () => undefined : this.#windows.retain(windowId);
  }

  closeWindow(windowId: string): void {
    this.#windows.close(windowId);
  }
}

export const searchRouteSessions = new SearchRouteSessionService();
