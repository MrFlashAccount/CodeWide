import { Tabs } from "expo-router/js-tabs";
import type { ComponentProps, ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { screensEnabled } from "react-native-screens";

import {
  WorkspaceTabsNavigationProvider,
  WorkspaceTabSceneNavigationProvider,
} from "./WorkspaceTabSceneNavigationProvider";

type LayoutProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["layout"]>>[0];
type ScreenLayoutProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["screenLayout"]>>[0];

/** Owns standard tab history and retained scene isolation without a sibling visual tab bar. */
export function WorkspaceTabsRouteLayout(): React.JSX.Element {
  return (
    <Tabs
      backBehavior="history"
      layout={renderWorkspaceTabsNavigation}
      screenLayout={renderWorkspaceTabScene}
      screenOptions={{ animation: "none", headerShown: false, lazy: false }}
      tabBar={renderNoVisualTabBar}
    >
      <Tabs.Screen name="(threads)" />
      <Tabs.Screen name="(pull-requests)" />
    </Tabs>
  );
}

/** Keeps a retained tab's layout stable while the native navigator owns scene visibility. */
export function WorkspaceTabSceneIsolation({
  active,
  children,
  routeName,
}: {
  readonly active: boolean;
  readonly children: ReactElement;
  readonly routeName: string;
}): React.JSX.Element {
  const nativeSceneOwnsVisibility = screensEnabled();
  return (
    <View
      accessibilityElementsHidden={!active}
      aria-hidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      pointerEvents={active ? "auto" : "none"}
      style={active || nativeSceneOwnsVisibility ? styles.scene : styles.fallbackInactiveScene}
      testID={`workspace-tab-scene-${routeName}`}
    >
      {children}
    </View>
  );
}

function renderWorkspaceTabScene(props: ScreenLayoutProps): React.JSX.Element {
  const state = props.navigation.getState();
  const active = state.routes[state.index]?.key === props.route.key;
  return (
    <WorkspaceTabSceneIsolation active={active} routeName={props.route.name}>
      <WorkspaceTabSceneNavigationProvider active={active}>
        {props.children}
      </WorkspaceTabSceneNavigationProvider>
    </WorkspaceTabSceneIsolation>
  );
}

function renderWorkspaceTabsNavigation(props: LayoutProps): React.JSX.Element {
  return (
    <WorkspaceTabsNavigationProvider navigation={props.navigation} state={props.state}>
      {props.children}
    </WorkspaceTabsNavigationProvider>
  );
}

function renderNoVisualTabBar(): null {
  return null;
}

const styles = StyleSheet.create({
  fallbackInactiveScene: {
    display: "none",
    flex: 1,
  },
  scene: {
    flex: 1,
  },
});
