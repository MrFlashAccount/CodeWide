import type { BottomTabBarProps } from "expo-router/js-tabs";

import type { CatalogMode } from "../features/pullRequests/CatalogModeBar";
import { workspaceTabRouteNameForMode, workspaceTabState } from "./workspaceTabNavigation";

type WorkspaceTabRoute = BottomTabBarProps["state"]["routes"][number];

type WorkspaceTabActivationActions = {
  readonly emitTabPress: (routeKey: string) => boolean;
  readonly navigate: (routeName: string, params: WorkspaceTabRoute["params"]) => void;
};

/** Emits the standard cancelable tab event before changing the parent TabRouter focus. */
export function activateWorkspaceTab(
  state: BottomTabBarProps["state"],
  selectedMode: CatalogMode,
  actions: WorkspaceTabActivationActions,
): void {
  const current = workspaceTabState(state);
  if (current.status === "unavailable") {
    return;
  }
  const targetName = workspaceTabRouteNameForMode(selectedMode);
  const target =
    targetName === current.threadsRoute.name ? current.threadsRoute : current.pullRequestsRoute;
  const defaultPrevented = actions.emitTabPress(target.key);
  if (target.key !== current.activeRoute.key && !defaultPrevented) {
    actions.navigate(target.name, target.params);
  }
}
