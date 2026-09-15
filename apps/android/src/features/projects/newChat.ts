import { useEvent } from "../../react/useEvent";
import { useRef, useState } from "react";
import type { ThreadListServer } from "../connections/connectionPresentation";
import { ALL_SERVERS_ID } from "../navigation/serverSelection";
import type { ThreadNavigationModel } from "../navigation/threadNavigation";
import { resolveNewThreadRoute } from "./newThreadRouting";
import type { SidebarProject } from "./sidebarProjects";

/** Draft activation keeps the mounted workspace counter and opens no remote thread. */
export function useNewChat(
  setNewThreadVisible: (visible: boolean) => void,
  threadNavigation: ThreadNavigationModel,
  setActiveServerId: (id: string) => void,
  activeServerId: string,
  servers: ThreadListServer[],
  sidebarProject: SidebarProject | null,
  defaultProjectCwd: (serverId: string) => string | null,
  openConnectionSheet: () => void,
) {
  const newChatCounterRef = useRef(0);

  const openNewChat = useEvent(
    async (requestedServerId: string, cwd: string | null): Promise<void> => {
      if (requestedServerId === "") return;
      newChatCounterRef.current += 1;
      threadNavigation.openDraft({
        id: `new-chat-${Date.now()}-${newChatCounterRef.current}`,
        serverId: requestedServerId,
        cwd,
        workspaceMode: "current",
      });
      setActiveServerId(requestedServerId);
      setNewThreadVisible(false);
    },
  );

  const createSidebarThread = useEvent((): void => {
    if (sidebarProject !== null) {
      void openNewChat(sidebarProject.connectionId, sidebarProject.path);
      return;
    }
    const route = resolveNewThreadRoute({
      activeServerId,
      allServersId: ALL_SERVERS_ID,
      serverIds: servers.map(({ id }) => id),
    });
    if (route.type === "connect-server") {
      openConnectionSheet();
      return;
    }
    if (route.type === "choose-server") {
      setNewThreadVisible(true);
      return;
    }
    void openNewChat(route.serverId, defaultProjectCwd(route.serverId));
  });

  return { createSidebarThread, openNewChat };
}

/** Visibility survives catalog changes within the mounted workspace. */
export function useNewChatVisibility() {
  return useState(false);
}
