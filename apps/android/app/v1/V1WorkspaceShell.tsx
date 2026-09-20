import { Stack } from "expo-router";
import { View } from "react-native";

import { workspaceRuntime } from "../../src/data/workspace-runtime";
import { useNavigationPerformanceHudInset } from "../../src/features/diagnostics/navigationPerformanceHudLayout";
import { useReducedMotionPreference } from "../../src/rendering/reduced-motion-store";
import {
  WorkspaceRouteResourcesContext,
  type WorkspaceRouteResources,
} from "../../src/services/workspace/workspaceRouteResources";
import { RenderRecoveryProvider } from "../../src/ui/RecoverableRenderBoundary";
import { WorkspaceVoiceAura } from "../../src/ui/WorkspaceVoiceAura";
import {
  v1FullscreenScreenOptions,
  v1DesktopRouteScreenOptions,
  v1ListScreenOptions,
  v1MobileRouteScreenOptions,
  v1RouteScreenOptions,
  v1SheetScreenOptions,
  v1WorkspaceShellStyles as styles,
} from "./V1WorkspaceShell.styles";

type V1WorkspaceShellProps = {
  readonly children: React.JSX.Element;
  readonly pathname: string;
  readonly resources: WorkspaceRouteResources;
};

const DESKTOP_DESTINATION_LAYOUT = {
  accessibilityElementsHidden: false,
  containerStyle: styles.desktopWorkspace,
  destinationStyle: styles.destination,
  importantForAccessibility: "auto",
  pointerEvents: "auto",
  showList: true,
} as const;
const MOBILE_DESTINATION_LAYOUT = {
  accessibilityElementsHidden: false,
  containerStyle: styles.flex,
  destinationStyle: styles.mobileDestination,
  importantForAccessibility: "auto",
  pointerEvents: "auto",
  showList: false,
} as const;
const MOBILE_LIST_LAYOUT = {
  accessibilityElementsHidden: true,
  containerStyle: styles.flex,
  destinationStyle: styles.hiddenMobileDestination,
  importantForAccessibility: "no-hide-descendants",
  pointerEvents: "none",
  showList: true,
} as const;
const MOBILE_LIST_PATHS = new Set(["/v1", "/v1/search"]);

function resolveDestinationLayout(desktop: boolean, pathname: string) {
  if (desktop) {
    return DESKTOP_DESTINATION_LAYOUT;
  }
  return MOBILE_LIST_PATHS.has(pathname) ? MOBILE_LIST_LAYOUT : MOBILE_DESTINATION_LAYOUT;
}

/** Owns the persistent V1 visual shell around route destinations. */
export function V1WorkspaceShell(props: V1WorkspaceShellProps): React.JSX.Element {
  const { resources } = props;
  return (
    <WorkspaceRouteResourcesContext.Provider value={resources}>
      <V1WorkspaceRecovery {...props} />
    </WorkspaceRouteResourcesContext.Provider>
  );
}

function V1WorkspaceRecovery(props: V1WorkspaceShellProps): React.JSX.Element {
  return (
    <RenderRecoveryProvider onFix={props.resources.recovery.createRenderFailureFixThread}>
      <V1WorkspaceChrome {...props} />
    </RenderRecoveryProvider>
  );
}

function V1WorkspaceChrome(props: V1WorkspaceShellProps): React.JSX.Element {
  const { resources } = props;
  const diagnosticsInset = useNavigationPerformanceHudInset();
  return (
    <WorkspaceVoiceAura
      controller={workspaceRuntime.voiceController}
      resources={resources.runtime.resources}
    >
      <View
        style={[
          styles.root,
          {
            paddingBottom: resources.insets.bottom,
            paddingTop: resources.insets.top + diagnosticsInset,
          },
        ]}
        testID="v1-workspace-shell"
      >
        <V1WorkspaceDestinations {...props} />
      </View>
    </WorkspaceVoiceAura>
  );
}

function V1WorkspaceDestinations(props: V1WorkspaceShellProps): React.JSX.Element {
  const layout = resolveDestinationLayout(props.resources.desktop, props.pathname);
  return (
    <View style={layout.containerStyle}>
      {props.resources.desktop ? (
        props.children
      ) : (
        <View
          accessibilityElementsHidden={!layout.showList}
          importantForAccessibility={layout.showList ? "auto" : "no-hide-descendants"}
          pointerEvents={layout.showList ? "auto" : "none"}
          style={styles.flex}
          testID="v1-workspace-list"
        >
          {props.children}
        </View>
      )}
      <View
        accessibilityElementsHidden={layout.accessibilityElementsHidden}
        collapsable={false}
        importantForAccessibility={layout.importantForAccessibility}
        pointerEvents={layout.pointerEvents}
        style={layout.destinationStyle}
        testID="v1-workspace-destination"
      >
        <V1WorkspaceDestinationStack desktop={props.resources.desktop} />
      </View>
    </View>
  );
}

function V1WorkspaceDestinationStack({
  desktop,
}: {
  readonly desktop: boolean;
}): React.JSX.Element {
  const reducedMotion = useReducedMotionPreference();
  const routeScreenOptions = reducedMotion
    ? v1RouteScreenOptions
    : desktop
      ? v1DesktopRouteScreenOptions
      : v1MobileRouteScreenOptions;
  return (
    <Stack screenOptions={routeScreenOptions}>
      <Stack.Screen name="index" options={v1ListScreenOptions} />
      <Stack.Screen name="browser/[sessionId]" options={v1FullscreenScreenOptions} />
      <Stack.Screen name="drawing/[sessionId]" options={v1FullscreenScreenOptions} />
      <Stack.Screen name="projects/add/[connectionId]" options={v1SheetScreenOptions} />
      <Stack.Screen name="projects/index" options={v1SheetScreenOptions} />
      <Stack.Screen name="search" options={v1SheetScreenOptions} />
      <Stack.Screen name="settings/index" options={v1SheetScreenOptions} />
      <Stack.Screen name="settings/servers/new/index" options={v1SheetScreenOptions} />
    </Stack>
  );
}
