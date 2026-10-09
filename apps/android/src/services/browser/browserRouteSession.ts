import { RouteSessionRegistry, ROUTE_SESSION_TTL_MS } from "../routeSessionPolicy";
import {
  sameRouteSessionOwner,
  type V1RouteSessionOwner,
  type V1ThreadRouteParams,
} from "../threads/threadRouteParams";
import { browserTabCatalog } from "./browserTabCatalog";
import { BrowserTabsModel } from "./browserTabsModel";
import type { BrowserPageDestination } from "./browserTab";

const MAX_BROWSER_SESSIONS = 4;

/** Bounded browser destination retained outside route parameters. */
type BrowserRouteSession = {
  readonly id: string;
  readonly initialView: "page" | "tabs";
  readonly owner: V1RouteSessionOwner;
  readonly tabs: BrowserTabsModel;
  readonly thread: V1ThreadRouteParams | null;
  touchedAt: number;
};

/** Retains secret-bearing browser destinations behind bounded opaque route identifiers. */
class BrowserRouteSessionService {
  readonly #sessions = new RouteSessionRegistry<BrowserRouteSession>({
    limit: MAX_BROWSER_SESSIONS,
    ttlMs: ROUTE_SESSION_TTL_MS,
  });

  open(
    owner: V1RouteSessionOwner,
    destination: BrowserPageDestination,
    thread: V1ThreadRouteParams | null = null,
  ): BrowserRouteSession {
    const tabs = thread === null ? new BrowserTabsModel() : browserTabCatalog.forThread(thread);
    tabs.open(destination);
    return this.#present({ initialView: "page", owner, tabs, thread });
  }

  openTabs(owner: V1RouteSessionOwner, thread: V1ThreadRouteParams): BrowserRouteSession {
    const tabs = browserTabCatalog.forThread(thread);
    return this.#present({ initialView: "tabs", owner, tabs, thread });
  }

  /** Reopens the selected page, or local Home when the chat catalog is empty. */
  resume(owner: V1RouteSessionOwner, thread: V1ThreadRouteParams): BrowserRouteSession {
    const tabs = browserTabCatalog.forThread(thread);
    return this.#present({ initialView: "page", owner, tabs, thread });
  }

  #present(input: {
    readonly initialView: "page" | "tabs";
    readonly owner: V1RouteSessionOwner;
    readonly tabs: BrowserTabsModel;
    readonly thread: V1ThreadRouteParams | null;
  }): BrowserRouteSession {
    input.tabs.ensureHome();
    const session = {
      id: `browser-${globalThis.crypto.randomUUID()}`,
      initialView: input.initialView,
      owner: input.owner,
      tabs: input.tabs,
      thread: input.thread,
      touchedAt: Date.now(),
    };
    this.#sessions.admit(session);
    return session;
  }

  get(id: string, owner: V1RouteSessionOwner): BrowserRouteSession | null {
    const session = this.#sessions.get(id);
    return session !== null && sameRouteSessionOwner(session.owner, owner) ? session : null;
  }

  retain(id: string, owner: V1RouteSessionOwner): () => void {
    const session = this.get(id, owner);
    if (session === null) {
      return () => undefined;
    }
    const releaseSession = this.#sessions.retain(id);
    const releaseTabs =
      session.thread === null ? () => undefined : browserTabCatalog.retain(session.thread);
    return () => {
      releaseSession();
      releaseTabs();
    };
  }

  close(id: string): void {
    this.#sessions.close(id);
  }
}

export const browserRouteSessions = new BrowserRouteSessionService();
