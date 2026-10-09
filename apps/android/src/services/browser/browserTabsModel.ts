import { computed, observable } from "@legendapp/state";
import { BrowserTab, type BrowserTabId, type BrowserPageDestination } from "./browserTab";

/** Selection is present exactly when there is at least one tab. */
export type BrowserTabsSnapshot =
  | { readonly kind: "empty" }
  | {
      readonly after: readonly BrowserTab[];
      readonly before: readonly BrowserTab[];
      readonly kind: "tabs";
      readonly selected: BrowserTab;
    };

/** Traverses the published tab order without copying private page owners. */
export function* browserTabsInOrder(snapshot: BrowserTabsSnapshot): Generator<BrowserTab> {
  if (snapshot.kind === "tabs") {
    yield* snapshot.before;
    yield snapshot.selected;
    yield* snapshot.after;
  }
}

/** Owns tab order and selection; presentation dismissal does not dispose this model. */
export class BrowserTabsModel {
  readonly id = globalThis.crypto.randomUUID();
  readonly #state$ = observable<{ snapshot: BrowserTabsSnapshot }>({ snapshot: { kind: "empty" } });
  readonly state$ = computed(() => this.#state$.snapshot.get());

  /** Adds and selects a fresh page; even identical popup URLs remain distinct tabs. */
  open(destination: BrowserPageDestination): BrowserTab {
    return this.#admit(new BrowserTab({ destination, kind: "page" }));
  }

  /** Creates a local Home tab without a WebView or network request. */
  openHome(): BrowserTab {
    return this.#admit(new BrowserTab({ kind: "home" }));
  }

  /** Presentation always begins with a real tab; teardown may still empty the catalog. */
  ensureHome(): void {
    if (this.#state$.snapshot.peek().kind === "empty") {
      this.openHome();
    }
  }

  /** The sole local Home is the browser's persistent starting point. */
  canClose(id: BrowserTabId): boolean {
    const current = this.#state$.snapshot.peek();
    if (current.kind === "empty") {
      return false;
    }
    return current.selected.id === id
      ? current.before.length > 0 ||
          current.after.length > 0 ||
          current.selected.destination !== null
      : current.before.some((tab) => tab.id === id) || current.after.some((tab) => tab.id === id);
  }

  #admit(tab: BrowserTab): BrowserTab {
    // Capture the ordered owners for the next immutable published selection snapshot.
    const before = Array.from(browserTabsInOrder(this.#state$.snapshot.peek()));
    this.#state$.snapshot.set({ after: [], before, kind: "tabs", selected: tab });
    return tab;
  }

  /** Selects an existing tab without navigating or replacing its native page. */
  select(id: BrowserTabId): void {
    const before: BrowserTab[] = [];
    const after: BrowserTab[] = [];
    let selected: BrowserTab | null = null;
    for (const tab of browserTabsInOrder(this.#state$.snapshot.peek())) {
      if (tab.id === id) {
        selected = tab;
      } else if (selected === null) {
        before.push(tab);
      } else {
        after.push(tab);
      }
    }
    if (selected !== null) {
      this.#state$.snapshot.set({ after, before, kind: "tabs", selected });
    }
  }

  /** Closes exactly one tab; active close chooses the next neighbour, then the previous one. */
  close(id: BrowserTabId): void {
    const current = this.#state$.snapshot.peek();
    if (current.kind === "empty" || !this.canClose(id)) {
      return;
    }
    if (current.selected.id !== id) {
      this.#state$.snapshot.set({
        after: current.after.filter((tab) => tab.id !== id),
        before: current.before.filter((tab) => tab.id !== id),
        kind: "tabs",
        selected: current.selected,
      });
      return;
    }
    const next = current.after[0];
    const previous = current.before.at(-1);
    if (next !== undefined) {
      this.#state$.snapshot.set({
        after: current.after.slice(1),
        before: current.before,
        kind: "tabs",
        selected: next,
      });
    } else if (previous !== undefined) {
      this.#state$.snapshot.set({
        after: [],
        before: current.before.slice(0, -1),
        kind: "tabs",
        selected: previous,
      });
    } else {
      this.#state$.snapshot.set({
        after: [],
        before: [],
        kind: "tabs",
        selected: new BrowserTab({ kind: "home" }),
      });
    }
  }

  /** Retires every private page destination on catalog expiry or workspace teardown. */
  clear(): void {
    this.#state$.snapshot.set({ kind: "empty" });
  }
}
