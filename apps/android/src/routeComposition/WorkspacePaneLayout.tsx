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
import { useEvent } from "../react/useEvent";
import { ConversationSelectionPlaceholder } from "../features/conversation/ConversationEmptyState";
import { desktopThreadSidebarWidth } from "../presentation/layouts/windowLayout";
import { useWorkspaceRouteResources } from "../services/workspace/workspaceRouteResources";
import { v1WorkspaceShellStyles } from "./WorkspaceShell.styles";
import { isNoServerWorkspace } from "./noServerWorkspace";

type PaneLayoutProps = Parameters<NonNullable<ComponentProps<typeof Stack>["layout"]>>[0];
type ScreenLayoutProps = Parameters<NonNullable<ComponentProps<typeof Stack>["screenLayout"]>>[0];

const DestinationPlacement = createContext(false);

/** Places the one Router-owned catalog beside or beneath the native detail stack. */
export function WorkspacePaneLayout(props: PaneLayoutProps): React.JSX.Element {
  const { desktop, runtime, viewportWidth } = useWorkspaceRouteResources();
  const catalogFocused = props.state.routes[props.state.index]?.name === "(lists)";
  const welcomeVisible = catalogFocused && isNoServerWorkspace(runtime);
  const { content: catalogContent, status: catalogStatus } = catalogPresentation(props);
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
    <View style={styles.panes}>
      <CatalogPane focused={catalogFocused} fullWidth={welcomeVisible}>
        {catalogContent}
      </CatalogPane>
      <View
        collapsable={false}
        pointerEvents={desktop || !catalogFocused ? "auto" : "none"}
        style={
          welcomeVisible
            ? styles.hidden
            : desktop
              ? v1WorkspaceShellStyles.destination
              : styles.detail
        }
        testID="v1-workspace-destination"
      >
        <DestinationPlacement.Provider value={true}>{props.children}</DestinationPlacement.Provider>
      </View>
    </View>
  );
}

function catalogPresentation(props: PaneLayoutProps) {
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

function CatalogPane({
  children,
  focused,
  fullWidth,
}: {
  readonly children: ReactElement | null | undefined;
  readonly focused: boolean;
  readonly fullWidth: boolean;
}): React.JSX.Element {
  const { desktop, viewportWidth } = useWorkspaceRouteResources();
  const accessible = desktop || focused;
  const onLayout = useEvent((event: LayoutChangeEvent): void => {
    const { height, width } = event.nativeEvent.layout;
    workspaceCatalogDiagnostics.record({ height, surface: "pane", type: "layout", width });
  });
  return (
    <View
      accessibilityElementsHidden={!accessible}
      importantForAccessibility={accessible ? "auto" : "no-hide-descendants"}
      onLayout={onLayout}
      pointerEvents={accessible ? "auto" : "none"}
      style={
        fullWidth
          ? styles.fullWidthCatalog
          : desktop
            ? [styles.catalog, { width: desktopThreadSidebarWidth(viewportWidth) }]
            : StyleSheet.absoluteFill
      }
      testID="workspace-catalog-pane"
    >
      {children}
    </View>
  );
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
  catalog: { flexShrink: 0 },
  detail: { flex: 1 },
  fullWidthCatalog: { flex: 1 },
  hidden: { display: "none" },
  panes: {
    flex: 1,
    flexDirection: "row",
  },
});
