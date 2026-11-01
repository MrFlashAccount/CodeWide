import { Stack } from "expo-router";
import { createContext, useContext, type ComponentProps, type ReactElement } from "react";

import { useReducedMotionPreference } from "../rendering/reduced-motion-store";
import { useWorkspaceRouteResources } from "../services/workspace/workspaceRouteResources";
import { PullRequestsPreviewRoute } from "./PullRequestsCatalogRoute";
import { WorkspaceCatalogMaster } from "./WorkspaceCatalogMaster";
import { WorkspacePaneFrame } from "./WorkspacePaneFrame";
import {
  v1CatalogRootScreenOptions,
  v1DesktopRouteScreenOptions,
  v1MobileRouteScreenOptions,
  v1RouteScreenOptions,
} from "./WorkspaceShell.styles";
import type { WorkspaceFramePresentation } from "./workspacePanes";

type PaneLayoutProps = Parameters<NonNullable<ComponentProps<typeof Stack>["layout"]>>[0];
type ScreenLayoutProps = Parameters<NonNullable<ComponentProps<typeof Stack>["screenLayout"]>>[0];
const PullRequestsDestinationPlacement = createContext(false);

/** Owns the retained Pull requests Stack plus its catalog/detail pane composition. */
export function PullRequestsWorkspaceRouteLayout(): React.JSX.Element {
  const { desktop } = useWorkspaceRouteResources();
  const reducedMotion = useReducedMotionPreference();
  const routeScreenOptions = reducedMotion
    ? v1RouteScreenOptions
    : desktop
      ? v1DesktopRouteScreenOptions
      : v1MobileRouteScreenOptions;
  return (
    <Stack
      layout={renderPullRequestsPaneLayout}
      screenLayout={renderPullRequestsScreenLayout}
      screenOptions={routeScreenOptions}
    >
      <Stack.Screen name="pulls/index" options={v1CatalogRootScreenOptions} />
    </Stack>
  );
}

/** Places the real Pull requests catalog descriptor around its subtree-owned destinations. */
export function PullRequestsWorkspacePaneLayout(props: PaneLayoutProps): React.JSX.Element {
  const { desktop, viewportWidth } = useWorkspaceRouteResources();
  const focusedRouteName = props.state.routes[props.state.index]?.name ?? null;
  const catalogFocused = focusedRouteName === "pulls/index";
  const catalog = pullRequestsCatalogPresentation(props);
  return (
    <WorkspacePaneFrame
      catalog={
        <WorkspaceCatalogMaster mode="pullRequests">{catalog.content}</WorkspaceCatalogMaster>
      }
      catalogFocused={catalogFocused}
      catalogStatus={catalog.status}
      desktop={desktop}
      detail={
        <PullRequestsDestinationPlacement.Provider value>
          {props.children}
        </PullRequestsDestinationPlacement.Provider>
      }
      presentation={pullRequestsPresentation({ catalogFocused, desktop, viewportWidth })}
      viewportWidth={viewportWidth}
    />
  );
}

/** Replaces the anchored catalog duplicate with its empty wide detail presentation. */
export function PullRequestsWorkspaceScreenLayout(props: ScreenLayoutProps): React.JSX.Element {
  return props.route.name === "pulls/index" ? (
    <PullRequestsCatalogPlacement>{props.children}</PullRequestsCatalogPlacement>
  ) : (
    props.children
  );
}

function PullRequestsCatalogPlacement({
  children,
}: {
  readonly children: ReactElement;
}): React.JSX.Element | null {
  const destination = useContext(PullRequestsDestinationPlacement);
  return destination ? <PullRequestsPreviewRoute /> : children;
}

function pullRequestsCatalogPresentation(props: PaneLayoutProps) {
  const catalog = props.state.routes.find((route) => route.name === "pulls/index");
  if (catalog === undefined) {
    return { content: null, status: "missing-route" as const };
  }
  const descriptor = props.descriptors[catalog.key];
  return descriptor === undefined
    ? { content: null, status: "missing-descriptor" as const }
    : { content: descriptor.render(), status: "present" as const };
}

function pullRequestsPresentation({
  catalogFocused,
  desktop,
  viewportWidth,
}: {
  readonly catalogFocused: boolean;
  readonly desktop: boolean;
  readonly viewportWidth: number;
}): WorkspaceFramePresentation {
  if (catalogFocused) {
    return desktop ? { kind: "wide", viewportWidth } : { kind: "catalogOnly" };
  }
  return desktop ? { kind: "wide", viewportWidth } : { kind: "detailOnly" };
}

function renderPullRequestsPaneLayout(props: PaneLayoutProps): React.JSX.Element {
  return <PullRequestsWorkspacePaneLayout {...props} />;
}

function renderPullRequestsScreenLayout(props: ScreenLayoutProps): React.JSX.Element {
  return <PullRequestsWorkspaceScreenLayout {...props} />;
}
