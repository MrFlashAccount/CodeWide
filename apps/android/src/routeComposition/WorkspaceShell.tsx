import { Stack } from "expo-router";
import { WorkspacePaneLayout, WorkspaceScreenLayout } from "./WorkspacePaneLayout";
import { View } from "react-native";

import { workspaceRuntime } from "../data/workspace-runtime";
import { useNavigationPerformanceHudInset } from "../features/diagnostics/navigationPerformanceHudLayout";
import { useReducedMotionPreference } from "../rendering/reduced-motion-store";
import {
  WorkspaceRouteResourcesContext,
  type WorkspaceRouteResources,
} from "../services/workspace/workspaceRouteResources";
import { RenderRecoveryProvider } from "../ui/RecoverableRenderBoundary";
import { WorkspaceVoiceAura } from "../ui/WorkspaceVoiceAura";
import {
  v1FullscreenScreenOptions,
  v1DesktopRouteScreenOptions,
  v1ListScreenOptions,
  v1MobileRouteScreenOptions,
  v1RouteScreenOptions,
  v1SheetScreenOptions,
  v1WorkspaceShellStyles as styles,
} from "./WorkspaceShell.styles";

type WorkspaceShellProps = {
  readonly resources: WorkspaceRouteResources;
};

/** Owns the persistent V1 visual shell around route destinations. */
export function WorkspaceShell(props: WorkspaceShellProps): React.JSX.Element {
  const { resources } = props;
  return (
    <WorkspaceRouteResourcesContext.Provider value={resources}>
      <V1WorkspaceRecovery {...props} />
    </WorkspaceRouteResourcesContext.Provider>
  );
}

function V1WorkspaceRecovery(props: WorkspaceShellProps): React.JSX.Element {
  return (
    <RenderRecoveryProvider onFix={props.resources.recovery.createRenderFailureFixThread}>
      <V1WorkspaceChrome {...props} />
    </RenderRecoveryProvider>
  );
}

function V1WorkspaceChrome(props: WorkspaceShellProps): React.JSX.Element {
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

function V1WorkspaceDestinations(props: WorkspaceShellProps): React.JSX.Element {
  return <V1WorkspaceDestinationStack desktop={props.resources.desktop} />;
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
    <Stack
      layout={renderWorkspacePaneLayout}
      screenLayout={renderWorkspaceScreenLayout}
      screenOptions={routeScreenOptions}
    >
      <Stack.Screen name="(lists)" options={v1ListScreenOptions} />
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

// Layout callbacks are invoked by navigation; compiled components need their own React boundary.
function renderWorkspacePaneLayout(
  props: Parameters<typeof WorkspacePaneLayout>[0],
): React.JSX.Element {
  return <WorkspacePaneLayout {...props} />;
}
function renderWorkspaceScreenLayout(
  props: Parameters<typeof WorkspaceScreenLayout>[0],
): React.JSX.Element {
  return <WorkspaceScreenLayout {...props} />;
}
