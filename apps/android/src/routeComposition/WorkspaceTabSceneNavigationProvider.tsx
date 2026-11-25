import type { BottomTabBarProps } from "expo-router/js-tabs";
import { useEffect, useRef, type ReactNode } from "react";
import { useSharedValue } from "react-native-reanimated";

import type { CatalogMode } from "../features/pullRequests/CatalogModeBar";
import { useEvent } from "../react/useEvent";
import { activateWorkspaceTab } from "./workspaceTabActivation";
import { workspaceTabState } from "./workspaceTabNavigation";
import {
  WorkspaceTabLayerContext,
  WorkspaceTabsNavigationContext,
} from "./workspaceTabSceneNavigation";

const TAB_LAYER_IDLE_MS = 1500;

type WorkspaceTabsNavigation = BottomTabBarProps["navigation"];

/** Binds the real parent TabRouter state and event emitter without mirroring its selection. */
export function WorkspaceTabsNavigationProvider({
  children,
  navigation,
  state,
}: {
  readonly children: ReactNode;
  readonly navigation: WorkspaceTabsNavigation;
  readonly state: BottomTabBarProps["state"];
}): React.JSX.Element {
  const { layerActive, retainLayer } = useTabSwitchLayer();
  const activate = useEvent((mode: CatalogMode): void => {
    activateWorkspaceTab(state, mode, {
      emitTabPress: (routeKey) =>
        navigation.emit({
          canPreventDefault: true,
          target: routeKey,
          type: "tabPress",
        }).defaultPrevented,
      navigate: (routeName, params) => {
        retainLayer();
        navigateWorkspaceTab(navigation, routeName, params);
      },
    });
  });
  const tab = workspaceTabState(state);
  const activeMode = tab.status === "ready" ? tab.activeMode : null;
  return (
    <WorkspaceTabsNavigationContext.Provider value={{ activate, activeMode }}>
      <WorkspaceTabLayerContext.Provider value={layerActive}>
        {children}
      </WorkspaceTabLayerContext.Provider>
    </WorkspaceTabsNavigationContext.Provider>
  );
}

// Adjacent taps reuse the texture. Allocating and releasing it for every spring stalls frames.
function useTabSwitchLayer() {
  const layerActive = useSharedValue(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearIdle = useEvent(() => {
    if (idleTimer.current !== null) {
      clearTimeout(idleTimer.current);
    }
    idleTimer.current = null;
  });
  const release = useEvent(() => {
    layerActive.set(false);
    idleTimer.current = null;
  });
  const retainLayer = useEvent(() => {
    clearIdle();
    layerActive.set(true);
    idleTimer.current = setTimeout(release, TAB_LAYER_IDLE_MS);
  });
  // The navigator owns the pending idle timer.
  useEffect(() => clearIdle, [clearIdle]);
  return { layerActive, retainLayer };
}

function navigateWorkspaceTab(
  navigation: WorkspaceTabsNavigation,
  routeName: string,
  params: BottomTabBarProps["state"]["routes"][number]["params"],
): void {
  if (params === undefined) {
    navigation.navigate(routeName);
    return;
  }
  navigation.navigate(routeName, params);
}
