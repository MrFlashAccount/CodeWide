import type { BottomTabBarProps } from "expo-router/js-tabs";
import type { ReactNode } from "react";

import type { CatalogMode } from "../features/pullRequests/CatalogModeBar";
import { useEvent } from "../react/useEvent";
import { activateWorkspaceTab } from "./workspaceTabActivation";
import {
  useWorkspaceTabsNavigation,
  WorkspaceTabsNavigationContext,
  WorkspaceTabSceneNavigationContext,
} from "./workspaceTabSceneNavigation";

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
  const activate = useEvent((mode: CatalogMode): void => {
    activateWorkspaceTab(state, mode, {
      emitTabPress: (routeKey) =>
        navigation.emit({
          canPreventDefault: true,
          target: routeKey,
          type: "tabPress",
        }).defaultPrevented,
      navigate: (routeName, params) => {
        navigateWorkspaceTab(navigation, routeName, params);
      },
    });
  });
  return (
    <WorkspaceTabsNavigationContext.Provider value={{ activate }}>
      {children}
    </WorkspaceTabsNavigationContext.Provider>
  );
}

/** Adds only this retained scene's active flag to the parent activation capability. */
export function WorkspaceTabSceneNavigationProvider({
  active,
  children,
}: {
  readonly active: boolean;
  readonly children: ReactNode;
}): React.JSX.Element {
  const parent = useWorkspaceTabsNavigation();
  return (
    <WorkspaceTabSceneNavigationContext.Provider
      value={{ activate: parent.activate, tabActive: active }}
    >
      {children}
    </WorkspaceTabSceneNavigationContext.Provider>
  );
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
