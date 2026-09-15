import { useEvent } from "../../react/useEvent";
import type { ThreadListItem } from "../threadList/threadListTypes";
import { threadSelectionKey } from "./threadSelection";

export const ALL_SERVERS_ID = "__all_servers__";

import { useState } from "react";
import type { StoredConnection } from "../../data/connection-profile-types";
import { ThreadServerProjection } from "../connections/connectionPresentation";

/** Server selection normalizes removed servers and disables automatic desktop selection. */
export function useServerSelection(connections: StoredConnection[], resetThreadList: () => void) {
  const [threadServerProjection] = useState(() => new ThreadServerProjection());

  const servers = threadServerProjection.project(connections);

  const [requestedServerId, setActiveServerId] = useState(ALL_SERVERS_ID);

  const [desktopDefaultThreadEnabled, setDesktopDefaultThreadEnabled] = useState(true);

  const activeServerId =
    servers.length <= 1 || requestedServerId === ALL_SERVERS_ID
      ? ALL_SERVERS_ID
      : servers.some((server) => server.id === requestedServerId)
        ? requestedServerId
        : ALL_SERVERS_ID;

  const selectServer = useEvent((serverId: string) => {
    resetThreadList();
    setDesktopDefaultThreadEnabled(false);
    setActiveServerId(serverId);
  });
  return { servers, activeServerId, setActiveServerId, desktopDefaultThreadEnabled, selectServer };
}

/** Automatic desktop admission uses the first current active row until explicit server selection. */
export function defaultDesktopThreadSelection(
  desktop: boolean,
  desktopDefaultThreadEnabled: boolean,
  serverThreads: readonly ThreadListItem[],
) {
  const defaultDesktopThreadId =
    desktop && desktopDefaultThreadEnabled && serverThreads[0] !== undefined
      ? threadSelectionKey(serverThreads[0])
      : null;
  return defaultDesktopThreadId;
}
