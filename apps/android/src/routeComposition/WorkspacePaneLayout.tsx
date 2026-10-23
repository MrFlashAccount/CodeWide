import type { Stack } from "expo-router";
import {
  createContext,
  useContext,
  useEffect,
  type ComponentProps,
  type ReactElement,
} from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";

import { workspaceCatalogDiagnostics } from "../data/workspaceCatalogDiagnostics";
import type { CatalogMode } from "../features/pullRequests/CatalogModeBar";
import { useEvent } from "../react/useEvent";
import { ConversationSelectionPlaceholder } from "../features/conversation/ConversationEmptyState";
import {
  catalogModeBarBottomInset,
  catalogModeBarHorizontalInset,
} from "../presentation/layouts/catalogModeBarGeometry";
import { desktopThreadSidebarWidth } from "../presentation/layouts/windowLayout";
import { useWorkspaceRouteResources } from "../services/workspace/workspaceRouteResources";
import { CatalogModeBarHost } from "./CatalogModeBarHost";
import { PullRequestsCatalogPane } from "./PullRequestsCatalogRoute";
import { v1WorkspaceShellStyles } from "./WorkspaceShell.styles";
import {
  WorkspaceTwoPaneLayout,
  type WorkspaceTwoPanePresentation,
} from "./WorkspaceTwoPaneLayout";
import { isNoServerWorkspace } from "./noServerWorkspace";

type PaneLayoutProps = Parameters<NonNullable<ComponentProps<typeof Stack>["layout"]>>[0];
type ScreenLayoutProps = Parameters<NonNullable<ComponentProps<typeof Stack>["screenLayout"]>>[0];

const DestinationPlacement = createContext(false);
const FLOATING_MODE_BAR_Z_INDEX = 20;

/** Places the one Router-owned catalog beside or beneath the native detail stack. */
export function WorkspacePaneLayout(props: PaneLayoutProps): React.JSX.Element {
  const { desktop, runtime, viewportWidth } = useWorkspaceRouteResources();
  const focusedRoute = props.state.routes[props.state.index];
  const threadsCatalogFocused = focusedRoute?.name === "(lists)";
  const pullRequestsCatalogFocused = focusedRoute?.name === "pulls/index";
  const pullRequestsFocused = isPullRequestsRoute(focusedRoute?.name);
  const catalogFocused = threadsCatalogFocused || pullRequestsCatalogFocused;
  const noServer = isNoServerWorkspace(runtime);
  const welcomeVisible = isWelcomeVisible(threadsCatalogFocused, noServer);
  const catalogMode = visibleCatalogMode(focusedRoute?.name, desktop, noServer);
  const { content: catalogContent, status: catalogStatus } = catalogPresentation(
    props,
    pullRequestsCatalogFocused,
  );
  const presentation = workspacePanePresentation({
    desktop,
    pullRequestsCatalogFocused,
    pullRequestsFocused,
    viewportWidth,
    welcomeVisible,
  });
  const catalogAccessibility = catalogAccessibilityProps(presentation, desktop, catalogFocused);
  const detailInteraction = detailInteractionProps(desktop, catalogFocused);
  const onCatalogLayout = useEvent((event: LayoutChangeEvent): void => {
    const { height, width } = event.nativeEvent.layout;
    workspaceCatalogDiagnostics.record({ height, surface: "pane", type: "layout", width });
  });
  useEffect(() => {
    workspaceCatalogDiagnostics.record({
      catalog: catalogStatus,
      desktop,
      focused: catalogFocused,
      type: "navigation",
      viewportWidth,
    });
  }, [catalogStatus, desktop, catalogFocused, viewportWidth]);
  return (
    <WorkspaceTwoPaneLayout
      catalog={catalogContent ?? null}
      catalogViewProps={{
        ...catalogAccessibility,
        onLayout: onCatalogLayout,
        testID: "workspace-catalog-pane",
      }}
      detail={
        <DestinationPlacement.Provider value={true}>{props.children}</DestinationPlacement.Provider>
      }
      detailStyle={workspaceDestinationSurfaceStyle(desktop)}
      detailViewProps={{
        collapsable: false,
        ...detailInteraction,
        testID: "v1-workspace-destination",
      }}
      overlay={
        <FloatingCatalogModeBar
          desktop={desktop}
          mode={catalogMode}
          viewportWidth={viewportWidth}
        />
      }
      presentation={presentation}
    />
  );
}

function isWelcomeVisible(catalogFocused: boolean, noServer: boolean): boolean {
  return catalogFocused && noServer;
}

function catalogAccessibilityProps(
  presentation: WorkspaceTwoPanePresentation,
  desktop: boolean,
  catalogFocused: boolean,
) {
  const accessible = presentation.kind !== "detailOnly" && (desktop || catalogFocused);
  if (accessible) {
    return {
      accessibilityElementsHidden: false,
      importantForAccessibility: "auto" as const,
      pointerEvents: "auto" as const,
    };
  }
  return {
    accessibilityElementsHidden: true,
    importantForAccessibility: "no-hide-descendants" as const,
    pointerEvents: "none" as const,
  };
}

function detailInteractionProps(desktop: boolean, catalogFocused: boolean) {
  return { pointerEvents: desktop || !catalogFocused ? ("auto" as const) : ("none" as const) };
}

function workspacePanePresentation({
  desktop,
  pullRequestsCatalogFocused,
  pullRequestsFocused,
  viewportWidth,
  welcomeVisible,
}: {
  readonly desktop: boolean;
  readonly pullRequestsCatalogFocused: boolean;
  readonly pullRequestsFocused: boolean;
  readonly viewportWidth: number;
  readonly welcomeVisible: boolean;
}): WorkspaceTwoPanePresentation {
  if (pullRequestsCatalogFocused) {
    return desktop ? { kind: "wide", viewportWidth } : { kind: "catalogOnly" };
  }
  if (pullRequestsFocused) {
    return { kind: "detailOnly" };
  }
  if (welcomeVisible) {
    return { kind: "catalogOnly" };
  }
  return desktop ? { kind: "wide", viewportWidth } : { kind: "stacked" };
}

function visibleCatalogMode(
  routeName: string | undefined,
  desktop: boolean,
  noServer: boolean,
): CatalogMode | null {
  if (routeName === "pulls/index") {
    return "pullRequests";
  }
  if (!noServer && !isPullRequestsRoute(routeName) && (routeName === "(lists)" || desktop)) {
    return "threads";
  }
  return null;
}

function FloatingCatalogModeBar({
  desktop,
  mode,
  viewportWidth,
}: {
  readonly desktop: boolean;
  readonly mode: CatalogMode | null;
  readonly viewportWidth: number;
}): React.JSX.Element | null {
  if (mode === null) {
    return null;
  }
  const surfaceWidth = desktop ? desktopThreadSidebarWidth(viewportWidth) : viewportWidth;
  const horizontalInsets = catalogModeBarHorizontalInset + catalogModeBarHorizontalInset;
  return (
    <View
      pointerEvents="box-none"
      style={[styles.floatingModeBar, { width: surfaceWidth - horizontalInsets }]}
      testID="floating-catalog-mode-bar"
    >
      <CatalogModeBarHost mode={mode} />
    </View>
  );
}

function catalogPresentation(props: PaneLayoutProps, pullRequestsCatalogFocused: boolean) {
  if (pullRequestsCatalogFocused) {
    return { content: <PullRequestsCatalogPane />, status: "present" as const };
  }
  const catalog = props.state.routes.find((route) => route.name === "(lists)");
  if (catalog === undefined) {
    return { content: null, status: "missing-route" as const };
  }
  const descriptor = props.descriptors[catalog.key];
  if (descriptor === undefined) {
    return { content: null, status: "missing-descriptor" as const };
  }
  return { content: descriptor.render(), status: "present" as const };
}

function isPullRequestsRoute(routeName: string | undefined): boolean {
  return routeName === "pulls" || routeName?.startsWith("pulls/") === true;
}

function workspaceDestinationSurfaceStyle(desktop: boolean) {
  return desktop ? v1WorkspaceShellStyles.destination : undefined;
}

/** Leaves a native history entry for the catalog without mounting its navigator twice. */
export function WorkspaceScreenLayout(props: ScreenLayoutProps): React.JSX.Element {
  return props.route.name === "(lists)" ? (
    <CatalogPlacement>{props.children}</CatalogPlacement>
  ) : (
    props.children
  );
}

function CatalogPlacement({
  children,
}: {
  readonly children: ReactElement;
}): React.JSX.Element | null {
  const destination = useContext(DestinationPlacement);
  const { desktop } = useWorkspaceRouteResources();
  if (destination) {
    return desktop ? <ConversationSelectionPlaceholder /> : null;
  }
  return children;
}

const styles = StyleSheet.create({
  floatingModeBar: {
    bottom: catalogModeBarBottomInset,
    left: catalogModeBarHorizontalInset,
    position: "absolute",
    zIndex: FLOATING_MODE_BAR_Z_INDEX,
  },
});
