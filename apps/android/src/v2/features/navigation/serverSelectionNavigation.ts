import { router } from "expo-router";

import type { SavedServerId } from "../../domain/ids";
import { serverDestination, serversDestination } from "./routeDestinations";

/** A server-selector change replaces the current selection instead of growing navigation history. */
export function replaceServerSelection(savedServerId: SavedServerId | null): void {
  if (savedServerId === null) {
    router.replace(serversDestination());
    return;
  }
  router.replace(serverDestination(savedServerId));
}
