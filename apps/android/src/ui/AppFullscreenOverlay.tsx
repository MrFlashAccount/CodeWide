import {
  createContext,
  Suspense,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useConstant } from "../react/useConstant";
import { useEvent } from "../react/useEvent";
import { colors } from "../theme";
import { AppFullscreenModal } from "./AppFullscreenModal";
import { RecoverableRenderBoundary } from "./RecoverableRenderBoundary";

export type AppFullscreenOverlayLifecycle = {
  didClose?: (id: string) => void;
  didOpen?: (id: string) => void;
  willOpen?: (id: string) => void;
};

export type AppFullscreenOverlayRender = (controls: { close: () => void }) => ReactNode;

export type AppFullscreenOverlayOptions = {
  /**
   * Keep the overlay mounted through a transient responsive-layout boundary
   * replacement. Explicit scope dismissal (for example, changing threads)
   * still closes it.
   */
  dismissOnScopeUnmount?: boolean;
};

export type AppFullscreenOverlayHandle = {
  close: () => void;
  id: string;
};

type OverlayBinding = {
  lifecycle: AppFullscreenOverlayLifecycle | null;
  scope: string;
};

type OverlayEntry = OverlayBinding & {
  content: ReactNode;
  dismissOnScopeUnmount: boolean;
  id: string;
  shown: boolean;
};

type OverlayHostController = {
  dismissScope: (scope: string) => void;
  dismissUnmountedScope: (scope: string) => void;
  present: (
    binding: OverlayBinding,
    render: AppFullscreenOverlayRender,
    options?: AppFullscreenOverlayOptions,
  ) => AppFullscreenOverlayHandle;
};

type OverlayPresentation = {
  close: (id: string) => void;
  entries: readonly OverlayEntry[];
  markAllShown: () => void;
};

export type AppFullscreenOverlayController = {
  dismissAll: () => void;
  dismissScope: (scope: string) => void;
  present: (
    render: AppFullscreenOverlayRender,
    options?: AppFullscreenOverlayOptions,
  ) => AppFullscreenOverlayHandle;
};

const AppFullscreenOverlayHostContext = createContext<OverlayHostController | null>(null);
const AppFullscreenOverlayPresentationContext = createContext<OverlayPresentation | null>(null);
const AppFullscreenOverlayBindingContext = createContext<OverlayBinding>({
  lifecycle: null,
  scope: "application",
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
    if (entry === undefined || entry.shown) {
      return;
    }
    entry.shown = true;
    entry.lifecycle?.didOpen?.(entry.id);
  };

  const close = useEvent((id: string) => {
    const current = entriesRef.current;
    const index = current.findIndex((entry) => entry.id === id);
    if (index < 0) {
      return;
    }
    const removed = current.slice(index);
    publish(current.slice(0, index));
    for (const entry of removed.reverse()) {
      entry.lifecycle?.didClose?.(entry.id);
    }
  });
  const markAllShown = useEvent(() => {
    for (const entry of entriesRef.current) {
      markShown(entry.id);
    }
  });

  const controller = useConstant<OverlayHostController>(() => ({
    dismissScope(scope) {
      const matching = entriesRef.current.filter((entry) => entry.scope === scope);
      if (matching.length === 0) {
        return;
      }
      const next = entriesRef.current.filter((entry) => entry.scope !== scope);
      publish(next);
      for (const entry of matching.reverse()) {
        entry.lifecycle?.didClose?.(entry.id);
      }
    },
    dismissUnmountedScope(scope) {
      const matching = entriesRef.current.filter(
        (entry) => entry.scope === scope && entry.dismissOnScopeUnmount,
      );
      if (matching.length === 0) {
        return;
      }
      const matchingIds = new Set(matching.map((entry) => entry.id));
      publish(entriesRef.current.filter((entry) => !matchingIds.has(entry.id)));
      for (const entry of matching.reverse()) {
        entry.lifecycle?.didClose?.(entry.id);
      }
    },
    present(binding, render, options) {
      sequenceRef.current += 1;
      const id = `fullscreen-overlay-${String(sequenceRef.current)}`;
      binding.lifecycle?.willOpen?.(id);
      const entry: OverlayEntry = {
        ...binding,
        content: render({
          close: () => {
            close(id);
          },
        }),
        dismissOnScopeUnmount: options?.dismissOnScopeUnmount ?? true,
        id,
        shown: false,
      };
      const nativeModalAlreadyOpen = entriesRef.current.length > 0;
      publish([...entriesRef.current, entry]);
      if (nativeModalAlreadyOpen) {
        requestAnimationFrame(() => {
          markShown(id);
        });
      }
      return {
        close: () => {
          close(id);
        },
        id,
      };
    },
  }));

  return (
    <AppFullscreenOverlayHostContext.Provider value={controller}>
      <AppFullscreenOverlayPresentationContext.Provider
        value={{
          close,
          entries,
          markAllShown,
        }}
      >
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
  const { close, entries, markAllShown } = presentation;
  const active = entries.at(-1) ?? null;
  if (active === null) {
    return null;
  }
  return (
    <AppFullscreenModal
      isOpen
      onClose={() => {
        close(active.id);
      }}
      onShow={() => {
        markAllShown();
      }}
    >
      <View style={styles.stack}>
        {entries.map((entry) => {
          const isActive = entry.id === active.id;
          return (
            <View
              accessibilityElementsHidden={!isActive}
              importantForAccessibility={isActive ? "yes" : "no-hide-descendants"}
              key={entry.id}
              pointerEvents={isActive ? "auto" : "none"}
              style={[styles.layer, !isActive && styles.hiddenLayer]}
            >
              <RecoverableRenderBoundary
                label="Fullscreen overlay content"
                onDismiss={() => {
                  close(entry.id);
                }}
                resetKey={entry.id}
                scope="dialog"
              >
                <Suspense fallback={<FullscreenOverlaySuspenseFallback />}>
                  {entry.content}
                </Suspense>
              </RecoverableRenderBoundary>
            </View>
          );
        })}
      </View>
    </AppFullscreenModal>
  );
}

function FullscreenOverlaySuspenseFallback() {
  return (
    <View
      accessibilityLabel="Loading view"
      style={styles.suspenseFallback}
      testID="fullscreen-overlay-suspense-fallback"
    >
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

export function AppFullscreenOverlayBoundary({
  children,
  lifecycle,
  scope,
}: {
  children: ReactNode;
  lifecycle: AppFullscreenOverlayLifecycle;
  scope: string;
}) {
  const host = useContext(AppFullscreenOverlayHostContext);
  if (host === null) {
    throw new Error(
      "AppFullscreenOverlayBoundary must be used inside AppFullscreenOverlayProvider",
    );
  }
  useLayoutEffect(
    () => () => {
      host.dismissUnmountedScope(scope);
    },
    [host, scope],
  );

  return (
    <AppFullscreenOverlayBindingContext.Provider value={{ lifecycle, scope }}>
      {children}
    </AppFullscreenOverlayBindingContext.Provider>
  );
}

export function useAppFullscreenOverlay(
  override?: Partial<OverlayBinding>,
): AppFullscreenOverlayController {
  const host = useContext(AppFullscreenOverlayHostContext);
  const inherited = useContext(AppFullscreenOverlayBindingContext);
  const binding: OverlayBinding = {
    lifecycle: override?.lifecycle === undefined ? inherited.lifecycle : override.lifecycle,
    scope: override?.scope ?? inherited.scope,
  };
  const present = useEvent(
    (render: AppFullscreenOverlayRender, options?: AppFullscreenOverlayOptions) => {
      if (host === null) {
        throw new Error("useAppFullscreenOverlay must be used inside AppFullscreenOverlayProvider");
      }
      return host.present(binding, render, options);
    },
  );
  const dismissAll = useEvent(() => {
    if (host === null) {
      throw new Error("useAppFullscreenOverlay must be used inside AppFullscreenOverlayProvider");
    }
    host.dismissScope(binding.scope);
  });
  const dismissScope = useEvent((scope: string) => {
    if (host === null) {
      throw new Error("useAppFullscreenOverlay must be used inside AppFullscreenOverlayProvider");
    }
    host.dismissScope(scope);
  });
  if (host === null) {
    throw new Error("useAppFullscreenOverlay must be used inside AppFullscreenOverlayProvider");
  }
  return {
    dismissAll,
    dismissScope,
    present,
  };
}

const styles = StyleSheet.create({
  layer: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  stack: {
    backgroundColor: "transparent",
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  // Keep parent workspaces mounted while a child fullscreen surface is open.
  // `display: none` preserves React and native view state (including ScrollView
  // offset) without painting an inactive WebView behind the active layer.
  hiddenLayer: { display: "none" },
  suspenseFallback: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: "center",
  },
});
