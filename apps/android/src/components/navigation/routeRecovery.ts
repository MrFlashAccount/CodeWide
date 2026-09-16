import type { useRouter } from "expo-router";

import type { V1ThreadDestination } from "../../services/threads/threadRouteParams";

type RouteRecoveryDestination = "/v1" | "/v1/new" | V1ThreadDestination;

/** Uses history when available and otherwise replaces a direct-entry URL with its stable owner. */
export function recoverUnavailableRoute(
  router: ReturnType<typeof useRouter>,
  fallback: RouteRecoveryDestination,
): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(fallback);
}
