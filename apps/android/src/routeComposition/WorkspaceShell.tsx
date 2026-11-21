import { Stack } from "expo-router";
import { View } from "react-native";

import { workspaceRuntime } from "../data/workspace-runtime";
import { BrowserWorkspaceHost } from "../features/browser/BrowserWorkspaceHost";
import { BrowserTabsNavigationContext } from "../features/browser/BrowserTabsNavigationContext";
import { BrowserHomePorts } from "../features/ports/BrowserHomePorts";
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
  v1BrowserScreenOptions,
  v1CatalogRootScreenOptions,
  v1DesktopRouteScreenOptions,
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
      <BrowserTabsNavigationContext.Provider value={resources.openBrowserTabs}>
        <V1WorkspaceRecovery {...props} />
      </BrowserTabsNavigationContext.Provider>
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
        <V1WorkspaceScenes {...props} />
        <BrowserWorkspaceHost
          bottomInset={resources.insets.bottom}
          feedback={resources.browserFeedback}
          renderHome={renderBrowserHome}
          topInset={resources.insets.top + diagnosticsInset}
        />
      </View>
    </WorkspaceVoiceAura>
  );
}

function renderBrowserHome(
  connectionId: string | null,
  onNavigate: (url: string) => void,
): React.JSX.Element {
  return <BrowserHomePorts connectionId={connectionId} onNavigate={onNavigate} />;
}

function V1WorkspaceScenes(props: WorkspaceShellProps): React.JSX.Element {
  return (
    <View collapsable={false} style={styles.scenes} testID="workspace-scenes">
      <V1WorkspaceDestinationStack desktop={props.resources.desktop} />
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
      <Stack.Screen name="(tabs)" options={v1CatalogRootScreenOptions} />
      <Stack.Screen name="browser/[sessionId]" options={v1BrowserScreenOptions} />
      <Stack.Screen name="drawing/[sessionId]" options={v1FullscreenScreenOptions} />
      <Stack.Screen name="settings/index" options={v1SheetScreenOptions} />
      <Stack.Screen name="settings/servers/new/index" options={v1SheetScreenOptions} />
    </Stack>
  );
}
