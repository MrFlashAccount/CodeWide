import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { type LayoutChangeEvent, StyleSheet, useWindowDimensions, View } from "react-native";

import { useEvent } from "../react/useEvent";

type VisibilityObserver = (viewportHeight: number) => void;

export type DiagramPreviewViewportController = {
  readonly register: (observer: VisibilityObserver) => () => void;
  readonly schedule: () => void;
};

const DiagramPreviewViewportContext = createContext<DiagramPreviewViewportController | null>(null);

export function useDiagramPreviewViewportController(): DiagramPreviewViewportController {
  const { height: viewportHeight } = useWindowDimensions();
  const observersRef = useRef(new Set<VisibilityObserver>());
  const frameRef = useRef<number | null>(null);
  const viewportHeightRef = useRef(viewportHeight);

  const checkVisibleDiagrams = useEvent(() => {
    frameRef.current = null;
    const viewportHeight = viewportHeightRef.current;
    for (const observer of observersRef.current) {
      observer(viewportHeight);
    }
  });
  const schedule = useEvent(() => {
    if (frameRef.current !== null) {
      return;
    }
    frameRef.current = requestAnimationFrame(checkVisibleDiagrams);
  });
  const register = useEvent((observer: VisibilityObserver) => {
    observersRef.current.add(observer);
    schedule();
    return () => {
      observersRef.current.delete(observer);
    };
  });
  useEffect(() => {
    viewportHeightRef.current = viewportHeight;
    schedule();
  }, [schedule, viewportHeight]);
  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    },
    [],
  );
  return { register, schedule };
}

export function DiagramPreviewViewportProvider({
  children,
  controller,
}: {
  readonly children: ReactNode;
  readonly controller: DiagramPreviewViewportController;
}) {
  return (
    <DiagramPreviewViewportContext.Provider value={controller}>
      {children}
    </DiagramPreviewViewportContext.Provider>
  );
}

export function DiagramPreviewVisibility({
  children,
}: {
  readonly children: (state: { readonly activated: boolean; readonly near: boolean }) => ReactNode;
}) {
  const controller = useContext(DiagramPreviewViewportContext);
  const ref = useRef<View | null>(null);
  const [visibleState, setVisibleState] = useState(() => ({
    activated: controller === null,
    near: controller === null,
  }));
  const checkVisibility = useEvent((viewportHeight: number) => {
    const preloadMargin = viewportHeight;
    ref.current?.measureInWindow((_x, y, _width, height) => {
      const near = y + height >= -preloadMargin && y <= viewportHeight + preloadMargin;
      setVisibleState((current) =>
        current.near === near && (current.activated || !near)
          ? current
          : { activated: current.activated || near, near },
      );
    });
  });
  useEffect(() => {
    if (controller === null) {
      return undefined;
    }
    return controller.register(checkVisibility);
  }, [checkVisibility, controller]);
  const onLayout = useEvent((_event: LayoutChangeEvent) => {
    controller?.schedule();
  });
  return (
    <View collapsable={false} onLayout={onLayout} ref={ref} style={styles.measurementRoot}>
      {children({
        activated: controller === null || visibleState.activated,
        near: controller === null || visibleState.near,
      })}
    </View>
  );
}

const styles = StyleSheet.create({ measurementRoot: { width: "100%" } });
