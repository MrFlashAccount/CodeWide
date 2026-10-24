import type { Stack } from "expo-router";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentProps,
  type ReactElement,
} from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";

import { workspaceCatalogDiagnostics } from "../data/workspaceCatalogDiagnostics";
import type { CatalogMode } from "../features/pullRequests/CatalogModeBar";
import { useEvent } from "../react/useEvent";
import { useConstant } from "../react/useConstant";
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
import {
  WorkspacePaneControllerContext,
  type WorkspacePaneController,
} from "./workspacePaneController";

type PaneLayoutProps = Parameters<NonNullable<ComponentProps<typeof Stack>["layout"]>>[0];
type ScreenLayoutProps = Parameters<NonNullable<ComponentProps<typeof Stack>["screenLayout"]>>[0];

const DestinationPlacement = createContext(false);
const FLOATING_MODE_BAR_Z_INDEX = 20;

/** Places the one Router-owned catalog beside or beneath the native detail stack. */
export function WorkspacePaneLayout(props: PaneLayoutProps): React.JSX.Element {
  const { desktop, runtime, viewportWidth } = useWorkspaceRouteResources();
  const [detailExpanded, setDetailExpanded] = useState(false);
  const paneController = useConstant<WorkspacePaneController>(() => ({ setDetailExpanded }));
  const focusedRoute = props.state.routes[props.state.index];
  const threadsCatalogFocused = focusedRoute?.name === "(lists)";
  const pullRequestsCatalogFocused = focusedRoute?.name === "pulls/index";
  const pullRequestsFocused = isPullRequestsRoute(focusedRoute?.name);
  const catalogFocused = threadsCatalogFocused || pullRequestsCatalogFocused;
  const noServer = isNoServerWorkspace(runtime);
  const welcomeVisible = isWelcomeVisible(threadsCatalogFocused, noServer);
  const catalogMode = visibleCatalogMode({
    desktop,
    detailExpanded,
    noServer,
    routeName: focusedRoute?.name,
  });
  const { content: catalogContent, status: catalogStatus } = catalogPresentation(
    props,
    pullRequestsFocused,
  );
  const presentation = workspacePanePresentation({
    desktop,
    detailExpanded,
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
        <WorkspacePaneControllerContext.Provider value={paneController}>
          <DestinationPlacement.Provider value={true}>
            {props.children}
          </DestinationPlacement.Provider>
        </WorkspacePaneControllerContext.Provider>
      }
      detailStyle={workspaceDestinationSurfaceStyle(desktop, detailExpanded)}
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
  const accessible =
    presentation.kind !== "detailOnly" &&
    presentation.kind !== "wideDetailExpanded" &&
    (desktop || catalogFocused);
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
  detailExpanded,
  pullRequestsCatalogFocused,
  pullRequestsFocused,
  viewportWidth,
  welcomeVisible,
}: {
  readonly desktop: boolean;
  readonly detailExpanded: boolean;
  readonly pullRequestsCatalogFocused: boolean;
  readonly pullRequestsFocused: boolean;
  readonly viewportWidth: number;
  readonly welcomeVisible: boolean;
}): WorkspaceTwoPanePresentation {
  if (pullRequestsCatalogFocused) {
    return desktop ? { kind: "wide", viewportWidth } : { kind: "catalogOnly" };
  }
  if (pullRequestsFocused) {
    if (!desktop) {
      return { kind: "detailOnly" };
    }
    return detailExpanded ? { kind: "wideDetailExpanded" } : { kind: "wide", viewportWidth };
  }
  if (welcomeVisible) {
    return { kind: "catalogOnly" };
  }
  return desktop ? { kind: "wide", viewportWidth } : { kind: "stacked" };
}

function visibleCatalogMode({
  desktop,
  detailExpanded,
  noServer,
  routeName,
}: {
  readonly desktop: boolean;
  readonly detailExpanded: boolean;
  readonly noServer: boolean;
  readonly routeName: string | undefined;
}): CatalogMode | null {
  if (detailExpanded) {
    return null;
  }
  if (routeName === "pulls/index" || (desktop && isPullRequestsRoute(routeName))) {
    return "pullRequests";
  }
  return threadsCatalogVisible({ desktop, noServer, routeName }) ? "threads" : null;
}

function threadsCatalogVisible({
  desktop,
  noServer,
  routeName,
}: {
  readonly desktop: boolean;
  readonly noServer: boolean;
  readonly routeName: string | undefined;
}): boolean {
  return !noServer && !isPullRequestsRoute(routeName) && (routeName === "(lists)" || desktop);
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

function catalogPresentation(props: PaneLayoutProps, pullRequestsFocused: boolean) {
  if (pullRequestsFocused) {
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

function workspaceDestinationSurfaceStyle(desktop: boolean, detailExpanded: boolean) {
  return desktop
    ? [v1WorkspaceShellStyles.destination, detailExpanded && styles.expandedDestination]
    : undefined;
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
  expandedDestination: {
    borderBottomLeftRadius: 0,
    borderTopLeftRadius: 0,
  },
  floatingModeBar: {
    bottom: catalogModeBarBottomInset,
    left: catalogModeBarHorizontalInset,
    position: "absolute",
    zIndex: FLOATING_MODE_BAR_Z_INDEX,
  },
});
