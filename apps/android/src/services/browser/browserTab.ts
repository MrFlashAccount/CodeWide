import { batch, computed, observable } from "@legendapp/state";

/** Local display identity; this address is never passed to WebView or the network. */
export const BROWSER_HOME_URL = "codewide://browser-home";

/** Opaque identity of a browser tab, distinct from a route or thread identity. */
export type BrowserTabId = { readonly kind: "browserTab"; readonly value: string };

/** Private navigation seed; credentials never enter a route or a composer chip. */
export type BrowserPageDestination = {
  readonly headers?: Readonly<Record<string, string>>;
  readonly title: string;
  readonly url: string;
};

/** Home is local content; only page sources create a native browser renderer. */
export type BrowserTabSource =
  | { readonly kind: "home" }
  | { readonly destination: BrowserPageDestination; readonly kind: "page" };

/** Last published page metadata; native history belongs to the mounted WebView. */
type BrowserTabMetadata = {
  readonly loading: boolean;
  readonly title: string;
  readonly url: string;
};

/** One page owner retained independently of browser presentation. */
export class BrowserTab {
  readonly id: BrowserTabId = { kind: "browserTab", value: globalThis.crypto.randomUUID() };
  readonly #metadata$;
  readonly metadata$;
  readonly #source$;
  readonly source$;
  readonly #favicon$ = observable<string | null>(null);
  readonly favicon$ = computed(() => this.#favicon$.get());

  constructor(source: BrowserTabSource) {
    this.#source$ = observable<{ source: BrowserTabSource }>({ source });
    this.source$ = computed(() => this.#source$.source.get());
    this.#metadata$ = observable<BrowserTabMetadata>({
      loading: false,
      title: source.kind === "home" ? "Home" : source.destination.title,
      url: source.kind === "home" ? BROWSER_HOME_URL : source.destination.url,
    });
    this.metadata$ = computed(() => this.#metadata$.get());
  }

  /** Returns a network seed only for a page; local Home has no network destination. */
  get destination(): BrowserPageDestination | null {
    const source = this.#source$.source.peek();
    return source.kind === "page" ? source.destination : null;
  }

  /** Opens the first page in a Home tab without replacing that tab's identity. */
  openPageFromHome(destination: BrowserPageDestination): void {
    if (this.#source$.source.peek().kind !== "home") {
      return;
    }
    batch(() => {
      this.#source$.source.set({ destination, kind: "page" });
      this.#metadata$.set({ loading: false, title: destination.title, url: destination.url });
    });
  }

  /** Publishes display metadata without replacing the mounted page's navigation seed. */
  publish(metadata: BrowserTabMetadata): void {
    if (this.#source$.source.peek().kind === "page") {
      this.#metadata$.set(metadata);
    }
  }

  /** Keeps the engine's small loaded icon in this tab's private, process-local owner. */
  publishFavicon(icon: string | null): void {
    this.#favicon$.set(icon);
  }
}
