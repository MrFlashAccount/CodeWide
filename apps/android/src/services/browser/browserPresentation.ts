import { computed, observable } from "@legendapp/state";
import type { V1ThreadRouteParams } from "../threads/threadRouteParams";
import type { BrowserTabsModel } from "./browserTabsModel";

type BrowserPresentationEntry = {
  readonly tabs: BrowserTabsModel;
  readonly thread: V1ThreadRouteParams | null;
};
type VisibleBrowser = {
  readonly initialView: "page" | "tabs";
  readonly onDismiss: () => void;
  readonly sessionId: string;
  readonly tabs: BrowserTabsModel;
};
type BrowserPresentationSnapshot = {
  readonly entries: readonly BrowserPresentationEntry[];
  readonly visible: VisibleBrowser | null;
};

/** Retains live page mounts independently of temporary Router browser destinations. */
class BrowserPresentationOwner {
  readonly #state$ = observable<BrowserPresentationSnapshot>({ entries: [], visible: null });
  readonly state$ = computed(() => this.#state$.get());

  /** Activates a private catalog; no URL or page content is projected into Router state. */
  show(input: {
    readonly initialView?: "page" | "tabs";
    readonly onDismiss: () => void;
    readonly sessionId: string;
    readonly tabs: BrowserTabsModel;
    readonly thread: V1ThreadRouteParams | null;
  }): void {
    const current = this.#state$.peek();
    const entries = current.entries.some((entry) => entry.tabs === input.tabs)
      ? current.entries
      : [...current.entries, { tabs: input.tabs, thread: input.thread }];
    this.#state$.set({
      entries,
      visible: {
        initialView: input.initialView ?? "page",
        onDismiss: input.onDismiss,
        sessionId: input.sessionId,
        tabs: input.tabs,
      },
    });
  }

  /** Returns to chat while keeping chat-owned native pages and history mounted. */
  hide(sessionId: string): void {
    const current = this.#state$.peek();
    if (current.visible?.sessionId !== sessionId) {
      return;
    }
    // Standalone destinations without a chat identity have no persistent tab scope.
    this.#state$.set({
      entries: current.entries.filter(
        (entry) => entry.thread !== null || entry.tabs !== current.visible?.tabs,
      ),
      visible: null,
    });
  }

  /** Releases page mounts and retained private state when the workspace is retired. */
  clear(): void {
    this.#state$.set({ entries: [], visible: null });
  }
}

/** One browser presentation owner for the process's single V1 workspace. */
export const browserPresentation = new BrowserPresentationOwner();
