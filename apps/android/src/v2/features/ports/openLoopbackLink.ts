import { router } from "expo-router";

import {
  createLocalhostBrowserHandler,
  type LocalhostTunnelPort,
  type LocalhostBrowserSession,
} from "../../application/ports/localhostBrowser";
import type { SavedServerId } from "../../domain/ids";
import { portTunnelBrowserDestination } from "../navigation/routeDestinations";

/** Adapts the secure bounded-tunnel flow to RichMarkdown's loopback-link capability. */
export function createOpenLoopbackLink(
  savedServerId: SavedServerId,
  ports: LocalhostTunnelPort,
): (url: string) => Promise<void> {
  const navigate = (session: LocalhostBrowserSession): void => {
    router.push(portTunnelBrowserDestination(savedServerId, session));
  };
  const handle = createLocalhostBrowserHandler({ navigate, ports });
  return async (url) => {
    if (!(await handle(url))) throw new Error("Loopback link must include an explicit port");
  };
}
