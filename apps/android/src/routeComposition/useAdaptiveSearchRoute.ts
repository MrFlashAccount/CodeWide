import { useEffect, useRef } from "react";

import { useEvent } from "../react/useEvent";
import { searchRouteSessions } from "../services/search/searchRouteSession";
import {
  v1ThreadDestination,
  workspaceRouteSessionOwner,
} from "../services/threads/threadRouteParams";
import { useAndroidBackHandler } from "../ui/use-android-back-handler";
import type { WorkspaceRouteModel } from "./WorkspaceRouteModel";

/** Keeps Search in the catalog without covering a selected wide chat's native screen. */
export function useAdaptiveSearchRoute(
  desktop: boolean,
  route: WorkspaceRouteModel,
): { readonly closeGlobalSearch: () => void; readonly openGlobalSearch: () => void } {
  const searchViaParam = useRef(false);
  const previousDesktop = useRef(desktop);
  useEffect(() => {
    const wasDesktop = previousDesktop.current;
    previousDesktop.current = desktop;
    if (wasDesktop === desktop) {
      return;
    }
    if (desktop) {
      moveSearchToDesktopParam(route, searchViaParam);
    } else if (searchViaParam.current) {
      moveSearchToMobileRoute(route, searchViaParam);
    }
  }, [desktop, route]);

  const openGlobalSearch = useEvent((): void => {
    const session = searchRouteSessions.open(workspaceRouteSessionOwner);
    if (desktop && route.currentThread !== null) {
      searchViaParam.current = true;
      route.router.setParams({ globalSearchSessionId: session.id });
      return;
    }
    searchViaParam.current = false;
    route.router.push({
      params: {
        globalSearchSessionId: session.id,
        ...(route.projectListSessionId === null
          ? {}
          : { projectListSessionId: route.projectListSessionId }),
        ...(route.currentThread === null
          ? {}
          : {
              connectionId: route.currentThread.connectionId.value,
              threadId: route.currentThread.threadId.value,
            }),
      },
      pathname: "/search",
    });
  });

  const closeGlobalSearch = useEvent((): void => {
    if (route.globalSearchSessionId !== null) {
      searchRouteSessions.close(route.globalSearchSessionId);
    }
    if (searchViaParam.current && route.pathname.startsWith("/threads/")) {
      searchViaParam.current = false;
      route.router.setParams({ globalSearchSessionId: undefined });
      return;
    }
    closeSearchRoute(route);
  });
  useAndroidBackHandler(
    desktop && route.pathname.startsWith("/threads/") && route.globalSearchSessionId !== null,
    closeGlobalSearch,
  );
  return { closeGlobalSearch, openGlobalSearch };
}

function moveSearchToMobileRoute(
  route: WorkspaceRouteModel,
  searchViaParam: { current: boolean },
): void {
  if (route.currentThread === null || route.globalSearchSessionId === null) {
    return;
  }
  searchViaParam.current = false;
  route.router.setParams({ globalSearchSessionId: undefined });
  route.router.push({
    params: {
      connectionId: route.currentThread.connectionId.value,
      globalSearchSessionId: route.globalSearchSessionId,
      ...(route.projectListSessionId === null
        ? {}
        : { projectListSessionId: route.projectListSessionId }),
      threadId: route.currentThread.threadId.value,
    },
    pathname: "/search",
  });
}

function moveSearchToDesktopParam(
  route: WorkspaceRouteModel,
  searchViaParam: { current: boolean },
): void {
  if (
    route.pathname !== "/search" ||
    route.currentThread === null ||
    route.globalSearchSessionId === null
  ) {
    return;
  }
  searchViaParam.current = true;
  const destination = v1ThreadDestination(route.currentThread);
  route.router.dismissTo({
    ...destination,
    params: {
      ...destination.params,
      globalSearchSessionId: route.globalSearchSessionId,
      ...(route.projectListSessionId === null
        ? {}
        : { projectListSessionId: route.projectListSessionId }),
    },
  });
}

function closeSearchRoute(route: WorkspaceRouteModel): void {
  if (route.currentThread !== null && route.pathname.startsWith("/threads/")) {
    const threadDestination = v1ThreadDestination(route.currentThread);
    const destination = {
      ...threadDestination,
      params: {
        ...threadDestination.params,
        ...(route.projectListSessionId === null
          ? {}
          : { projectListSessionId: route.projectListSessionId }),
      },
    };
    // Explicitly closing Search removes its history entry but keeps the selected result.
    route.router.dismissTo("/search");
    route.router.replace(destination);
    return;
  }
  if (route.router.canGoBack()) {
    route.router.back();
    return;
  }
  route.router.replace(
    route.currentThread === null ? "/" : v1ThreadDestination(route.currentThread),
  );
}
