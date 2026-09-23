import { useGlobalSearchParams, usePathname, useRouter } from "expo-router";

import {
  routeSessionIdParam,
  v1ThreadRouteParams,
  type V1ThreadDestination,
  type V1ThreadRouteParams,
} from "../services/threads/threadRouteParams";
import { useWorkspaceProjectSessionId } from "./workspaceProjectNavigation";
import type { V1ThreadRouter } from "../services/threads/threadNavigationService";

const THREAD_CONTEXT_ROUTE_PATTERN = /^\/(?:search$|(?:threads|browser|drawing)\/)/u;
/** Identifies routes whose global parameters carry the active V1 thread identity. */
export function isV1ThreadContextPath(pathname: string): boolean {
  return THREAD_CONTEXT_ROUTE_PATTERN.test(pathname);
}

function isDesktopSearchThreadRoute(
  desktop: boolean,
  pathname: string,
  globalSearchSessionId: string | null,
): boolean {
  return desktop && globalSearchSessionId !== null && pathname.startsWith("/threads/");
}

export type WorkspaceRouteModel = {
  readonly currentThread: V1ThreadRouteParams | null;
  readonly globalSearchSessionId: string | null;
  readonly pathname: string;
  readonly projectListSessionId: string | null;
  readonly router: ReturnType<typeof useRouter>;
  readonly threadRouter: V1ThreadRouter;
};

/** Avoids stacking the draft destination when its server picker is already mounted. */
export function ensureV1NewThreadRoute(
  router: ReturnType<typeof useRouter>,
  pathname: string,
  projectListSessionId: string | null = null,
): void {
  if (pathname === "/new") {
    return;
  }
  if (pathname !== "/" && !pathname.startsWith("/project/")) {
    router.dismissTo(
      projectListSessionId === null
        ? "/"
        : {
            params: { sessionId: projectListSessionId },
            pathname: "/project/[sessionId]",
          },
    );
  }
  if (projectListSessionId === null) {
    router.push("/new");
  } else {
    router.push({ params: { projectListSessionId }, pathname: "/new" });
  }
}

/** Adapts Expo Router state and commands to the V1 thread-navigation contract. */
export function useWorkspaceRouteModel(desktop = false): WorkspaceRouteModel {
  const router = useRouter();
  const pathname = usePathname();
  const routeParams = useGlobalSearchParams<{
    connectionId?: string | string[];
    globalSearchSessionId?: string | string[];
    projectListSessionId?: string | string[];
    searchWindowId?: string | string[];
    sessionId?: string | string[];
    threadId?: string | string[];
  }>();
  const parsedThread = isV1ThreadContextPath(pathname)
    ? v1ThreadRouteParams(routeParams)
    : { status: "invalid" as const };
  const currentThread = parsedThread.status === "valid" ? parsedThread.value : null;
  const parsedSearchSessionId = routeSessionIdParam(routeParams.globalSearchSessionId);
  const globalSearchSessionId =
    parsedSearchSessionId.status === "valid" ? parsedSearchSessionId.value.value : null;
  const projectListSessionId = useWorkspaceProjectSessionId();
  const searchWindow = routeSessionIdParam(routeParams.searchWindowId);
  const desktopSearchThreadRoute = isDesktopSearchThreadRoute(
    desktop,
    pathname,
    globalSearchSessionId,
  );
  const searchSelectionMode =
    pathname === "/search" || desktopSearchThreadRoute ? "push" : "replace";
  const threadRouter: V1ThreadRouter = {
    currentThread,
    dismissTo: router.dismissTo,
    dismissToAll() {
      if (globalSearchSessionId !== null && pathname.startsWith("/threads/")) {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace({
            params: {
              globalSearchSessionId,
              ...(projectListSessionId === null ? {} : { projectListSessionId }),
            },
            pathname: "/search",
          });
        }
      } else if (projectListSessionId !== null) {
        router.dismissTo({
          params: { sessionId: projectListSessionId },
          pathname: "/project/[sessionId]",
        });
      } else {
        router.dismissTo("/");
      }
    },
    link(destination) {
      return {
        dismissTo: pathname !== "/" && !pathname.startsWith("/project/"),
        href: {
          ...destination,
          params: {
            ...destination.params,
            // A link to the visible result retains its search window; another thread cannot inherit it.
            ...(searchWindow.status === "valid" &&
            currentThread?.connectionId.value === destination.params.connectionId &&
            currentThread.threadId.value === destination.params.threadId
              ? { searchWindowId: searchWindow.value.value }
              : {}),
            ...(globalSearchSessionId === null ? {} : { globalSearchSessionId }),
            ...(projectListSessionId === null ? {} : { projectListSessionId }),
          },
        },
      };
    },
    navigate: router.navigate,
    push(destination: V1ThreadDestination, searchWindowId?: string) {
      if (desktopSearchThreadRoute) {
        // A result leaves Search on the new route, not on its history entry.
        router.setParams({ globalSearchSessionId: undefined });
      }
      router.push({
        ...destination,
        params: {
          ...destination.params,
          ...(globalSearchSessionId === null ? {} : { globalSearchSessionId }),
          ...(projectListSessionId === null ? {} : { projectListSessionId }),
          ...(searchWindowId === undefined ? {} : { searchWindowId }),
        },
      });
    },
    replace(destination: V1ThreadDestination, searchWindowId?: string) {
      router.replace({
        ...destination,
        params: {
          ...destination.params,
          ...(globalSearchSessionId === null ? {} : { globalSearchSessionId }),
          ...(projectListSessionId === null ? {} : { projectListSessionId }),
          ...(searchWindowId === undefined ? {} : { searchWindowId }),
        },
      });
    },
    searchSelectionMode,
  };
  return {
    currentThread,
    globalSearchSessionId,
    pathname,
    projectListSessionId,
    router,
    threadRouter,
  };
}
