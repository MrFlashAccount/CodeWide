import type { CatalogMode } from "../features/pullRequests/CatalogModeBar";

type WorkspacePrimaryRoute =
  | { readonly kind: "catalog"; readonly mode: CatalogMode }
  | { readonly kind: "detail"; readonly mode: CatalogMode };

type WorkspaceRoute = { readonly name: string };

/** Primary workspace destination plus whether a route-owned overlay covers it. */
export type WorkspaceRouteProjection = {
  readonly focusedRouteName: string | null;
  readonly overlayFocused: boolean;
  readonly primary: WorkspacePrimaryRoute;
};

/**
 * Resolves the workspace destination below route-owned overlays. The visible
 * catalog and mode bar must follow that destination, never the overlay's name.
 */
export function projectWorkspaceRoutes(
  routes: readonly WorkspaceRoute[],
  index: number,
): WorkspaceRouteProjection {
  const focusedRouteName = routes[index]?.name ?? null;
  for (let routeIndex = Math.min(index, routes.length - 1); routeIndex >= 0; routeIndex -= 1) {
    const primary = classifyPrimaryRoute(routes[routeIndex]?.name);
    if (primary !== null) {
      return {
        focusedRouteName,
        overlayFocused: routeIndex !== index,
        primary,
      };
    }
  }
  return {
    focusedRouteName,
    overlayFocused: true,
    primary: { kind: "catalog", mode: "threads" },
  };
}

function classifyPrimaryRoute(routeName: string | undefined): WorkspacePrimaryRoute | null {
  return classifyCatalogRoute(routeName) ?? classifyDetailRoute(routeName);
}

function classifyCatalogRoute(routeName: string | undefined): WorkspacePrimaryRoute | null {
  if (routeName === "(lists)") {
    return { kind: "catalog", mode: "threads" };
  }
  if (routeName === "pulls/index") {
    return { kind: "catalog", mode: "pullRequests" };
  }
  return null;
}

function classifyDetailRoute(routeName: string | undefined): WorkspacePrimaryRoute | null {
  if (routeName?.startsWith("pulls/") === true) {
    return { kind: "detail", mode: "pullRequests" };
  }
  if (routeName === "new" || routeName?.startsWith("new/") === true) {
    return { kind: "detail", mode: "threads" };
  }
  if (routeName?.startsWith("threads/") === true) {
    return { kind: "detail", mode: "threads" };
  }
  return null;
}
