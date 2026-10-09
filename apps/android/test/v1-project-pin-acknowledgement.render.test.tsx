import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Pressable, Text } from "react-native";

import type { StoredConnection } from "../src/data/connection-profile-types";
import type { RemoteProject } from "../src/data/remote-projects";
import { ALL_SERVER_SCOPE } from "../src/services/servers/serverScope";
import { useProjectWorkspace } from "../src/features/projects/projectWorkspace";
import { SidebarProjectsSheet } from "../src/features/projects/SidebarProjectViews";
import { createProjectsWorkspaceAdapter } from "../src/features/projects/workspaceAdapter";

// WHY: SQLite and native sheet windows are platform boundaries unavailable in Node.
// The RPC adapter, shared Legend model, project commands and management rows stay real.
jest.mock("../src/data/remoteProjectCatalogCache", () => ({
  remoteProjectCatalogCache: { read: async () => [], write: async () => undefined },
}));
jest.mock("@expo/ui/community/bottom-sheet", () => {
  const { View, ScrollView } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    BottomSheet: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    BottomSheetView: View,
    BottomSheetScrollView: ScrollView,
  };
});

it("publishes pin/unpin acknowledgements to mounted management and sidebar consumers, surviving stale synchronization", async () => {
  const initial: RemoteProject = {
    addedAt: 1,
    lastUsedAt: 1,
    name: "Repo",
    path: "/repo",
    pinned: false,
  };
  let serverSnapshot = initial;
  let mutation = Promise.withResolvers<{ project: RemoteProject }>();
  const session = { rpc: jest.fn(), stop: jest.fn() };
  const rpc = jest.fn(async (_session, method) => {
    if (method === "companion/project/list") return { data: [serverSnapshot] };
    if (method === "companion/project/add") return mutation.promise;
    throw new Error("Unexpected project RPC");
  });
  const commands = createProjectsWorkspaceAdapter({
    getDetails: () => null,
    getSession: () => session,
    getSummaries: () => null,
    loadTurnControls: async () => {
      throw new Error("No thread creation expected");
    },
    rpcAfterAttach: rpc,
  });
  const connection: StoredConnection = {
    displayName: "Server",
    enabled: true,
    endpoint: "wss://example.test/v1/sync",
    iconId: "desktop",
    id: "pin-ack-render-server",
    lastError: null,
    lastErrorAt: null,
    sortOrder: 0,
    state: "live",
    token: "",
  };
  const servers = [
    { iconId: "desktop" as const, id: connection.id, name: "Server", status: "live" as const },
  ];
  function Harness({ state }: { state: StoredConnection["state"] }) {
    const capability = {
      ...commands,
      connections: [{ ...connection, state }],
      native: true,
      threadSummaryDatabase: null,
    };
    const management = useProjectWorkspace(capability, servers, ALL_SERVER_SCOPE, false);
    const sidebar = useProjectWorkspace(capability, servers, ALL_SERVER_SCOPE, false);
    return (
      <>
        <Pressable
          accessibilityLabel="Toggle first project"
          onPress={() => {
            const project = management.availableSidebarProjects[0];
            if (project !== undefined) void management.toggleSidebarProject(project);
          }}
        >
          <Text>Toggle</Text>
        </Pressable>
        <Pressable accessibilityLabel="Unpin first project" onPress={() => {
          const project = sidebar.pinnedSidebarProjects[0];
          if (project !== undefined) void sidebar.sidebarProjectActions.unpin(project);
        }}><Text>Unpin</Text></Pressable>
        <Text testID="sidebar-pins">
          {sidebar.pinnedSidebarProjects.map((project) => project.name).join(",")}
        </Text>
        <SidebarProjectsSheet
          errors={management.sidebarProjectErrors}
          onBrowse={() => undefined}
          onClose={() => undefined}
          onMove={management.moveSidebarProject}
          onToggle={management.toggleSidebarProject}
          projects={management.availableSidebarProjects}
          servers={servers}
          visible
        />
      </>
    );
  }
  const view = render(<Harness state="live" />);
  await waitFor(() => expect(view.getByText("Repo")).toBeVisible());
  expect(view.queryByText("Pinned")).toBeNull();
  fireEvent.press(view.getByLabelText("Toggle first project"));
  expect(view.queryByText("Pinned")).toBeNull();
  const pinned = { ...initial, lastUsedAt: 2, pinned: true };
  await act(async () => mutation.resolve({ project: pinned }));
  expect(view.getByText("Pinned")).toBeVisible();
  expect(view.getByTestId("sidebar-pins")).toHaveTextContent("Repo");
  expect(rpc).toHaveBeenCalledWith(session, "companion/project/add", {
    name: "Repo",
    path: "/repo",
    pinned: true,
  });

  await act(async () => view.rerender(<Harness state="syncing" />));
  expect(view.getByText("Pinned")).toBeVisible();
  expect(view.getByTestId("sidebar-pins")).toHaveTextContent("Repo");
  serverSnapshot = pinned;
  await act(async () => view.rerender(<Harness state="live" />));
  mutation = Promise.withResolvers<{ project: RemoteProject }>();
  fireEvent.press(view.getByLabelText("Unpin first project"));
  expect(view.getByText("Pinned")).toBeVisible();
  const unpinned = { ...pinned, lastUsedAt: 3, pinned: false };
  await act(async () => mutation.resolve({ project: unpinned }));
  expect(view.queryByText("Pinned")).toBeNull();
  expect(view.getByTestId("sidebar-pins").props.children).toBe("");
  expect(rpc).toHaveBeenCalledWith(session, "companion/project/add", {
    name: "Repo",
    path: "/repo",
    pinned: false,
  });
  await act(async () => view.rerender(<Harness state="syncing" />));
  expect(view.queryByText("Pinned")).toBeNull();
  serverSnapshot = unpinned;
  await act(async () => view.rerender(<Harness state="live" />));
});
