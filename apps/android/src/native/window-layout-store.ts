import { Dimensions } from "react-native";

import { windowLayoutSnapshot, type WindowLayoutSnapshot } from "./window-layout";

function currentWindowLayout(): WindowLayoutSnapshot {
  return windowLayoutSnapshot(Dimensions.get("window"));
}

class WindowLayoutStore {
  private snapshot = currentWindowLayout();
  private readonly listeners = new Set<() => void>();
  private subscription: { remove(): void } | null = null;

  readonly getSnapshot = (): WindowLayoutSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.subscription === null) {
      this.subscription = Dimensions.addEventListener("change", ({ window }) => {
        const next = windowLayoutSnapshot(window);
        if (
          next.width === this.snapshot.width
          && next.height === this.snapshot.height
          && next.scale === this.snapshot.scale
          && next.fontScale === this.snapshot.fontScale
        ) return;
        this.snapshot = next;
        for (const notify of this.listeners) notify();
      });
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size !== 0) return;
      this.subscription?.remove();
      this.subscription = null;
    };
  };
}

export const windowLayoutStore = new WindowLayoutStore();
