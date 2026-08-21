import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { StyleSheet, View } from "react-native";

import { AppFullscreenModal } from "./AppFullscreenModal";

export type AppFullscreenOverlayLifecycle = {
  willOpen?(id: string): void;
  didOpen?(id: string): void;
  didClose?(id: string): void;
};

export type AppFullscreenOverlayRender = (controls: { close(): void }) => ReactNode;

export type AppFullscreenOverlayOptions = {
  /**
   * Keep the overlay mounted through a transient responsive-layout boundary
   * replacement. Explicit scope dismissal (for example, changing threads)
   * still closes it.
   */
  dismissOnScopeUnmount?: boolean;
};

export type AppFullscreenOverlayHandle = {
  id: string;
  close(): void;
};

type OverlayBinding = {
  scope: string;
  lifecycle: AppFullscreenOverlayLifecycle | null;
};

type OverlayEntry = OverlayBinding & {
  id: string;
  content: ReactNode;
  dismissOnScopeUnmount: boolean;
  shown: boolean;
};

type OverlayHostController = {
  present(binding: OverlayBinding, render: AppFullscreenOverlayRender, options?: AppFullscreenOverlayOptions): AppFullscreenOverlayHandle;
  dismissScope(scope: string): void;
  dismissUnmountedScope(scope: string): void;
};

type OverlayPresentation = {
  entries: readonly OverlayEntry[];
  close(id: string): void;
  markAllShown(): void;
};

export type AppFullscreenOverlayController = {
  present(render: AppFullscreenOverlayRender, options?: AppFullscreenOverlayOptions): AppFullscreenOverlayHandle;
  dismissAll(): void;
  dismissScope(scope: string): void;
};

const AppFullscreenOverlayHostContext = createContext<OverlayHostController | null>(null);
const AppFullscreenOverlayPresentationContext = createContext<OverlayPresentation | null>(null);
const AppFullscreenOverlayBindingContext = createContext<OverlayBinding>({
  scope: "application",
  lifecycle: null,
});

/**
 * Owns fullscreen overlay state and lifecycle. The native modal itself is
 * mounted by `AppFullscreenOverlayHost`, which lets application-level service
 * providers wrap both the regular UI and every fullscreen overlay.
 *
 * `present()` runs the bound lifecycle before the modal enters the React tree,
 * so virtualized surfaces can capture their anchor synchronously. Callers never
 * coordinate modal state with an effect.
 */
export function AppFullscreenOverlayProvider({ children }: { children: ReactNode }) {
  const entriesRef = useRef<OverlayEntry[]>([]);
  const sequenceRef = useRef(0);
  const [entries, setEntries] = useState<OverlayEntry[]>([]);

  const publish = (next: OverlayEntry[]) => {
    entriesRef.current = next;
    setEntries(next);
  };
  const markShown = (id: string) => {
    const entry = entriesRef.current.find((candidate) => candidate.id === id);
    if (entry === undefined || entry.shown) return;
    entry.shown = true;
    entry.lifecycle?.didOpen?.(entry.id);
  };

  const close = (id: string) => {
    const current = entriesRef.current;
    const index = current.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    const removed = current.slice(index);
    publish(current.slice(0, index));
    for (const entry of removed.reverse()) entry.lifecycle?.didClose?.(entry.id);
  };

  const [controller] = useState<OverlayHostController>(() => ({
    present(binding, render, options) {
      sequenceRef.current += 1;
      const id = `fullscreen-overlay-${sequenceRef.current}`;
      binding.lifecycle?.willOpen?.(id);
      const entry: OverlayEntry = {
        ...binding,
        id,
        content: render({ close: () => close(id) }),
        dismissOnScopeUnmount: options?.dismissOnScopeUnmount ?? true,
        shown: false,
      };
      const nativeModalAlreadyOpen = entriesRef.current.length > 0;
      publish([...entriesRef.current, entry]);
      if (nativeModalAlreadyOpen) {
        requestAnimationFrame(() => markShown(id));
      }
      return { id, close: () => close(id) };
    },
    dismissScope(scope) {
      const matching = entriesRef.current.filter((entry) => entry.scope === scope);
      if (matching.length === 0) return;
      const next = entriesRef.current.filter((entry) => entry.scope !== scope);
      publish(next);
      for (const entry of matching.reverse()) entry.lifecycle?.didClose?.(entry.id);
    },
    dismissUnmountedScope(scope) {
      const matching = entriesRef.current.filter((entry) => entry.scope === scope && entry.dismissOnScopeUnmount);
      if (matching.length === 0) return;
      const matchingIds = new Set(matching.map((entry) => entry.id));
      publish(entriesRef.current.filter((entry) => !matchingIds.has(entry.id)));
      for (const entry of matching.reverse()) entry.lifecycle?.didClose?.(entry.id);
    },
  }));

  return (
    <AppFullscreenOverlayHostContext.Provider value={controller}>
      <AppFullscreenOverlayPresentationContext.Provider value={{
        entries,
        close,
        markAllShown: () => {
          for (const entry of entriesRef.current) markShown(entry.id);
        },
      }}>
        {children}
      </AppFullscreenOverlayPresentationContext.Provider>
    </AppFullscreenOverlayHostContext.Provider>
  );
}

/** The only owner of native fullscreen modal mounting. */
export function AppFullscreenOverlayHost() {
  const presentation = useContext(AppFullscreenOverlayPresentationContext);
  if (presentation === null) {
    throw new Error("AppFullscreenOverlayHost must be used inside AppFullscreenOverlayProvider");
  }
  const { entries, close, markAllShown } = presentation;
  const active = entries.at(-1) ?? null;
  if (active === null) return null;
  return (
    <AppFullscreenModal
      isOpen
      onClose={() => close(active.id)}
      onShow={() => {
        markAllShown();
      }}
    >
      <View style={styles.stack}>
        {entries.map((entry) => {
          const isActive = entry.id === active.id;
          return (
            <View
              key={entry.id}
              accessibilityElementsHidden={!isActive}
              importantForAccessibility={isActive ? "yes" : "no-hide-descendants"}
              pointerEvents={isActive ? "auto" : "none"}
              style={[styles.layer, !isActive && styles.hiddenLayer]}
            >
              {entry.content}
            </View>
          );
        })}
      </View>
    </AppFullscreenModal>
  );
}

export function AppFullscreenOverlayBoundary({
  scope,
  lifecycle,
  children,
}: {
  scope: string;
  lifecycle: AppFullscreenOverlayLifecycle;
  children: ReactNode;
}) {
  const host = useContext(AppFullscreenOverlayHostContext);
  if (host === null) throw new Error("AppFullscreenOverlayBoundary must be used inside AppFullscreenOverlayProvider");
  useLayoutEffect(() => () => host.dismissUnmountedScope(scope), [host, scope]);

  return (
    <AppFullscreenOverlayBindingContext.Provider value={{ scope, lifecycle }}>
      {children}
    </AppFullscreenOverlayBindingContext.Provider>
  );
}

export function useAppFullscreenOverlay(
  override?: Partial<OverlayBinding>,
): AppFullscreenOverlayController {
  const host = useContext(AppFullscreenOverlayHostContext);
  const inherited = useContext(AppFullscreenOverlayBindingContext);
  if (host === null) throw new Error("useAppFullscreenOverlay must be used inside AppFullscreenOverlayProvider");
  const binding: OverlayBinding = {
    scope: override?.scope ?? inherited.scope,
    lifecycle: override?.lifecycle === undefined ? inherited.lifecycle : override.lifecycle,
  };
  return {
    present: (render, options) => host.present(binding, render, options),
    dismissAll: () => host.dismissScope(binding.scope),
    dismissScope: (scope) => host.dismissScope(scope),
  };
}

const styles = StyleSheet.create({
  stack: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: "transparent" },
  layer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  // Keep parent workspaces mounted while a child fullscreen surface is open.
  // `display: none` preserves React and native view state (including ScrollView
  // offset) without painting an inactive WebView behind the active layer.
  hiddenLayer: { display: "none" },
});
