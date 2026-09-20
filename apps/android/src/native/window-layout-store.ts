import { Dimensions } from "react-native";

import { windowLayoutSnapshot, type WindowLayoutSnapshot } from "./window-layout";

function currentWindowLayout(): WindowLayoutSnapshot {
  return windowLayoutSnapshot(Dimensions.get("window"));
}

class WindowLayoutStore {
  private snapshot = currentWindowLayout();
  private readonly listeners = new Set<() => void>();
  private readonly measurementInvalidationListeners = new Set<() => void>();
  private subscription: { remove: () => void } | null = null;

  readonly getSnapshot = (): WindowLayoutSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.ensureSubscribed();
    return () => {
      this.listeners.delete(listener);
      this.unsubscribeWhenUnused();
    };
  };

  /** Subscribes to real density or font-scale changes that invalidate measured native layouts. */
  readonly subscribeMeasurementInvalidation = (listener: () => void): (() => void) => {
    this.measurementInvalidationListeners.add(listener);
    this.ensureSubscribed();
    return () => {
      this.measurementInvalidationListeners.delete(listener);
      this.unsubscribeWhenUnused();
    };
  };

  private ensureSubscribed(): void {
    if (this.subscription === null) {
      this.snapshot = currentWindowLayout();
      this.subscription = Dimensions.addEventListener("change", ({ window }) => {
        const next = windowLayoutSnapshot(window);
        if (
          next.width === this.snapshot.width &&
          next.height === this.snapshot.height &&
          next.scale === this.snapshot.scale &&
          next.fontScale === this.snapshot.fontScale
        ) {
          return;
        }
        const measurementsChanged = next.measurementRevision !== this.snapshot.measurementRevision;
        this.snapshot = next;
        if (measurementsChanged) {
          for (const notify of this.measurementInvalidationListeners) {
            notify();
          }
        }
        for (const notify of this.listeners) {
          notify();
        }
      });
    }
  }

  private unsubscribeWhenUnused(): void {
    if (this.listeners.size !== 0 || this.measurementInvalidationListeners.size !== 0) {
      return;
    }
    this.subscription?.remove();
    this.subscription = null;
  }
}

export const windowLayoutStore = new WindowLayoutStore();
