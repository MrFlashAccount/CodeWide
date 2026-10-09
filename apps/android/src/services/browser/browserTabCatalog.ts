import { RouteSessionRegistry, ROUTE_SESSION_TTL_MS } from "../routeSessionPolicy";
import { threadSelectionKey, type V1ThreadRouteParams } from "../threads/threadRouteParams";
import { BrowserTabsModel } from "./browserTabsModel";

type BrowserCatalogEntry = {
  readonly id: string;
  readonly model: BrowserTabsModel;
  touchedAt: number;
};

// Private inactive chat catalogs are bounded independently of mounted browser presentations.
const MAX_INACTIVE_BROWSER_CHATS = 16;

/** Retains device-local tabs under the exact connection/thread pair, never a project or URL. */
class BrowserTabCatalog {
  readonly #entries = new RouteSessionRegistry<BrowserCatalogEntry>({
    cleanup: (entry) => {
      entry.model.clear();
    },
    limit: MAX_INACTIVE_BROWSER_CHATS,
    ttlMs: ROUTE_SESSION_TTL_MS,
  });

  /** Reads or admits the stable model for an already-validated chat identity. */
  forThread(thread: V1ThreadRouteParams): BrowserTabsModel {
    const id = this.#key(thread);
    const existing = this.#entries.get(id);
    if (existing !== null) {
      return existing.model;
    }
    const model = new BrowserTabsModel();
    this.#entries.admit({ id, model, touchedAt: Date.now() });
    return model;
  }

  /** Protects a visible browser's private pages from idle expiry and passive eviction. */
  retain(thread: V1ThreadRouteParams): () => void {
    return this.#entries.retain(this.#key(thread));
  }

  #key(thread: V1ThreadRouteParams): string {
    return threadSelectionKey({ id: thread.threadId.value, serverId: thread.connectionId.value });
  }
}

/** Process-local catalog; no URLs, headers, page contents or tab list are persisted. */
export const browserTabCatalog = new BrowserTabCatalog();
