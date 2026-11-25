import { Tabs } from "expo-router/js-tabs";
import type { ComponentProps, ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { screensEnabled } from "react-native-screens";

import { MaskedTabBarMotionProvider } from "../vendor/reacticx/masked-tab-bar";
import { WorkspaceTabsNavigationProvider } from "./WorkspaceTabSceneNavigationProvider";

type LayoutProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["layout"]>>[0];

/** Keeps tab history in TabRouter and both nested native stacks in stable host views. */
export function WorkspaceTabsRouteLayout(): React.JSX.Element {
  return (
    <MaskedTabBarMotionProvider>
      <Tabs backBehavior="history" layout={renderWorkspaceTabsNavigation}>
        <Tabs.Screen name="(threads)" />
        <Tabs.Screen name="(pull-requests)" />
      </Tabs>
    </MaskedTabBarMotionProvider>
  );
}

/**
 * Keeps Fabric from reparenting the stack when opacity and accessibility change its
 * stacking context. Reparenting destroys TextureView surfaces inside the retained chat.
 */
export function WorkspaceTabSceneIsolation({
  active,
  children,
  routeName,
}: {
  readonly active: boolean;
  readonly children: ReactElement;
  readonly routeName: string;
}): React.JSX.Element {
  return (
    <View
      accessibilityElementsHidden={!active}
      aria-hidden={!active}
      collapsable={false}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      pointerEvents={active ? "auto" : "none"}
      style={[styles.scene, !active && (screensEnabled() ? styles.inactive : styles.hidden)]}
      testID={`workspace-tab-scene-${routeName}`}
    >
      {children}
    </View>
  );
}

function renderWorkspaceTabsNavigation({
  descriptors,
  navigation,
  state,
}: LayoutProps): React.JSX.Element {
  const activeKey = state.routes[state.index]?.key;
  return (
    <WorkspaceTabsNavigationProvider navigation={navigation} state={state}>
      <View style={styles.container}>
        {state.routes.map((route) => {
          const descriptor = descriptors[route.key];
          return descriptor === undefined ? null : (
            <WorkspaceTabSceneIsolation
              active={route.key === activeKey}
              key={route.key}
              routeName={route.name}
            >
              {descriptor.render()}
            </WorkspaceTabSceneIsolation>
          );
        })}
      </View>
    </WorkspaceTabsNavigationProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hidden: { display: "none" },
  inactive: { opacity: 0 },
  scene: {
    ...StyleSheet.absoluteFill,
    flex: 1,
  },
});
