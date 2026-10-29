import { Stack } from "expo-router";
import { createContext, useContext, type ComponentProps, type ReactElement } from "react";

import { ConversationSelectionPlaceholder } from "../features/conversation/ConversationEmptyState";
import { useReducedMotionPreference } from "../rendering/reduced-motion-store";
import { useWorkspaceRouteResources } from "../services/workspace/workspaceRouteResources";
import { isNoServerWorkspace } from "./noServerWorkspace";
import { WorkspaceCatalogMaster } from "./WorkspaceCatalogMaster";
import { WorkspacePaneFrame } from "./WorkspacePaneFrame";
import {
  v1DesktopRouteScreenOptions,
  v1ListScreenOptions,
  v1MobileRouteScreenOptions,
  v1RouteScreenOptions,
  v1RouteSheetScreenOptions,
  v1SheetScreenOptions,
} from "./WorkspaceShell.styles";
import type { WorkspaceTwoPanePresentation } from "./WorkspaceTwoPaneLayout";

type PaneLayoutProps = Parameters<NonNullable<ComponentProps<typeof Stack>["layout"]>>[0];
type ScreenLayoutProps = Parameters<NonNullable<ComponentProps<typeof Stack>["screenLayout"]>>[0];

const ThreadsDestinationPlacement = createContext(false);

/** Owns the retained Threads Stack plus its catalog/detail pane composition. */
export function ThreadsWorkspaceRouteLayout(): React.JSX.Element {
  const { desktop } = useWorkspaceRouteResources();
  const reducedMotion = useReducedMotionPreference();
  const routeScreenOptions = reducedMotion
    ? v1RouteScreenOptions
    : desktop
      ? v1DesktopRouteScreenOptions
      : v1MobileRouteScreenOptions;
  const routeSheetScreenOptions = reducedMotion ? v1SheetScreenOptions : v1RouteSheetScreenOptions;
  return (
    <Stack
      layout={renderThreadsPaneLayout}
      screenLayout={renderThreadsScreenLayout}
      screenOptions={routeScreenOptions}
    >
      <Stack.Screen name="(lists)" options={v1ListScreenOptions} />
      <Stack.Screen name="projects/add/[connectionId]" options={routeSheetScreenOptions} />
      <Stack.Screen name="projects/add/index" options={routeSheetScreenOptions} />
      <Stack.Screen name="projects/index" options={routeSheetScreenOptions} />
      <Stack.Screen name="search" options={v1SheetScreenOptions} />
    </Stack>
  );
}

/** Places the real Threads catalog descriptor around its subtree-owned destinations. */
export function ThreadsWorkspacePaneLayout(props: PaneLayoutProps): React.JSX.Element {
  const { desktop, runtime, viewportWidth } = useWorkspaceRouteResources();
  const focusedRouteName = props.state.routes[props.state.index]?.name ?? null;
  const catalogFocused = focusedRouteName === "(lists)";
  const welcomeVisible = catalogFocused && isNoServerWorkspace(runtime);
  const presentation = threadsPresentation({
    desktop,
    viewportWidth,
    welcomeVisible,
  });
  const catalog = threadsCatalogPresentation(props);
  return (
    <WorkspacePaneFrame
      catalog={
        <WorkspaceCatalogMaster mode="threads" navigationAvailable={!isNoServerWorkspace(runtime)}>
          {catalog.content}
        </WorkspaceCatalogMaster>
      }
      catalogFocused={catalogFocused}
      catalogStatus={catalog.status}
      desktop={desktop}
      detail={
        <ThreadsDestinationPlacement.Provider value>
          {props.children}
        </ThreadsDestinationPlacement.Provider>
      }
      presentation={presentation}
      viewportWidth={viewportWidth}
    />
  );
}

/** Prevents the anchored catalog descriptor from mounting twice inside the destination slot. */
export function ThreadsWorkspaceScreenLayout(props: ScreenLayoutProps): React.JSX.Element {
  return props.route.name === "(lists)" ? (
    <ThreadsCatalogPlacement>{props.children}</ThreadsCatalogPlacement>
  ) : (
    props.children
  );
}

function ThreadsCatalogPlacement({
  children,
}: {
  readonly children: ReactElement;
}): React.JSX.Element | null {
  const destination = useContext(ThreadsDestinationPlacement);
  const { desktop } = useWorkspaceRouteResources();
  if (!destination) {
    return children;
  }
  return desktop ? <ConversationSelectionPlaceholder /> : null;
}

function threadsCatalogPresentation(props: PaneLayoutProps) {
  const catalog = props.state.routes.find((route) => route.name === "(lists)");
  if (catalog === undefined) {
    return { content: null, status: "missing-route" as const };
  }
  const descriptor = props.descriptors[catalog.key];
  return descriptor === undefined
    ? { content: null, status: "missing-descriptor" as const }
    : { content: descriptor.render(), status: "present" as const };
}

function threadsPresentation({
  desktop,
  viewportWidth,
  welcomeVisible,
}: {
  readonly desktop: boolean;
  readonly viewportWidth: number;
  readonly welcomeVisible: boolean;
}): WorkspaceTwoPanePresentation {
  if (welcomeVisible) {
    return { kind: "catalogOnly" };
  }
  return desktop ? { kind: "wide", viewportWidth } : { kind: "stacked" };
}

function renderThreadsPaneLayout(props: PaneLayoutProps): React.JSX.Element {
  return <ThreadsWorkspacePaneLayout {...props} />;
}

function renderThreadsScreenLayout(props: ScreenLayoutProps): React.JSX.Element {
  return <ThreadsWorkspaceScreenLayout {...props} />;
}
