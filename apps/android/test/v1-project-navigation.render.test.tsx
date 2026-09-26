import { LegendList } from "@legendapp/list/react-native";
import { act, render, renderHook, waitFor } from "@testing-library/react-native";
import { KeyboardController } from "react-native-keyboard-controller";

import { useComposerProjectSelection } from "../src/features/projects/composerProjectSelection";
import { useProjectPickerSession } from "../src/features/projects/projectPickerSession";
import { SidebarProjectsSheet } from "../src/features/projects/SidebarProjects";
import { useRemoteProjectCatalog } from "../src/features/projects/useRemoteProjectCatalog";
import type { SidebarProject } from "../src/features/projects/sidebarProjects";
import {
  threadSelectionKey,
  v1ThreadRouteParams,
  type V1ThreadDestination,
  type V1ThreadRouteParams,
} from "../src/services/threads/threadRouteParams";
import { useThreadNavigationService } from "../src/services/threads/threadNavigationService";
import { useConversationOwner } from "../src/ui/use-conversation-owner";

function pending() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function routeParams(connectionId: string, threadId: string): V1ThreadRouteParams {
  const parsed = v1ThreadRouteParams({ connectionId, threadId });
  if (parsed.status === "invalid") throw new Error("Expected valid route parameters");
  return parsed.value;
}

const managedProject: SidebarProject = {
  connectionId: "server",
  key: "server:/workspace/project",
  lastUsedAt: 1,
  name: "Project",
  path: "/workspace/project",
  pinned: false,
  serverLabel: null,
  subtitle: "/workspace/project",
  unread: false,
};

const projectManagementProps = {
  errors: [],
  onBrowse: () => undefined,
  onClose: () => undefined,
  onMove: async () => undefined,
  onToggle: async () => undefined,
  servers: [{ id: "server", name: "Server" }],
  visible: true,
};

it("records project-picker navigation direction without animating its initial page", () => {
  const props = {
    browseOnly: false,
    busy: false,
    cwd: "/workspace",
    discoveredProjects: [],
    error: null,
    onAddProject: jest.fn(async (path: string) => ({
      addedAt: 1,
      lastUsedAt: 1,
      name: "Project",
      path,
      pinned: true,
    })),
    onClose: jest.fn(),
    onReadDirectory: jest.fn(async () => []),
    onSelect: jest.fn(async () => undefined),
    projects: [],
    visible: true,
  };
  const { result } = renderHook(() => useProjectPickerSession(props));

  expect(result.current.mode).toBe("projects");
  expect(result.current.navigationDirection).toBeNull();

  act(() => result.current.openDirectoryPicker());
  expect(result.current.mode).toBe("directory");
  expect(result.current.navigationDirection).toBe("forward");

  act(() => result.current.showProjects());
  expect(result.current.mode).toBe("projects");
  expect(result.current.navigationDirection).toBe("back");
});

it("publishes an acknowledged project mutation without remounting the project route", () => {
  const connectionId = "mutation-publication-server";
  const updated = {
    addedAt: 1,
    lastUsedAt: 2,
    name: "Project",
    path: "/workspace/project",
    pinned: true,
  };
  const { result } = renderHook(() => useRemoteProjectCatalog(false, [], async () => []));

  act(() => result.current.mergeProject(connectionId, updated));

  expect(result.current.projectsByConnection[connectionId]).toEqual([updated]);
});

it("notifies another mounted project catalog consumer after an acknowledged mutation", () => {
  const connectionId = "shared-mutation-publication-server";
  const updated = {
    addedAt: 1,
    lastUsedAt: 2,
    name: "Project",
    path: "/workspace/project",
    pinned: true,
  };
  const writer = renderHook(() => useRemoteProjectCatalog(false, [], async () => []));
  let readerRenders = 0;
  const reader = renderHook(() => {
    readerRenders += 1;
    return useRemoteProjectCatalog(false, [], async () => []);
  });
  const initialRenders = readerRenders;

  act(() => writer.result.current.mergeProject(connectionId, updated));

  expect(readerRenders).toBeGreaterThan(initialRenders);
  expect(reader.result.current.projectsByConnection[connectionId]).toEqual([updated]);
});

it("replaces an already loaded project immediately after a pin acknowledgement", async () => {
  const connectionId = "loaded-mutation-publication-server";
  const initial = {
    addedAt: 1,
    lastUsedAt: 1,
    name: "Project",
    path: "/workspace/project",
    pinned: false,
  };
  const updated = { ...initial, lastUsedAt: 2, pinned: true };
  const { result } = renderHook(() =>
    useRemoteProjectCatalog(
      true,
      [{ enabled: true, id: connectionId, state: "live" }],
      async () => [initial],
    ),
  );

  await waitFor(() => expect(result.current.projectsByConnection[connectionId]).toEqual([initial]));
  act(() => result.current.mergeProject(connectionId, updated));

  expect(result.current.projectsByConnection[connectionId]).toEqual([updated]);
});

it("invalidates the recycled management list when a pin acknowledgement changes rows", () => {
  const view = render(
    <SidebarProjectsSheet {...projectManagementProps} projects={[managedProject]} />,
  );
  const initialList = view.UNSAFE_getByType(LegendList);
  const initialVersion = initialList.props.dataVersion;
  expect(initialList.props.extraData).toBe(initialVersion);

  view.rerender(
    <SidebarProjectsSheet
      {...projectManagementProps}
      projects={[{ ...managedProject, pinned: true }]}
    />,
  );

  expect(view.getByText("Pinned")).toBeVisible();
  const pinnedList = view.UNSAFE_getByType(LegendList);
  const pinnedVersion = pinnedList.props.dataVersion;
  expect(pinnedVersion).not.toBe(initialVersion);
  expect(pinnedList.props.extraData).toBe(pinnedVersion);

  view.rerender(
    <SidebarProjectsSheet
      {...projectManagementProps}
      projects={[
        { ...managedProject, pinned: true },
        {
          ...managedProject,
          key: "server:/workspace/added",
          name: "Added",
          path: "/workspace/added",
          subtitle: "/workspace/added",
        },
      ]}
    />,
  );

  expect(view.getByText("Added")).toBeVisible();
  const addedList = view.UNSAFE_getByType(LegendList);
  expect(addedList.props.dataVersion).not.toBe(pinnedVersion);
  expect(addedList.props.extraData).toBe(addedList.props.dataVersion);
});

it("publishes the qualified route before observer hydration settles and keeps stable intents", async () => {
  const observation = pending();
  const observeThread = jest.fn(() => observation.promise);
  const current = { value: null as V1ThreadRouteParams | null };
  const push = jest.fn((destination: V1ThreadDestination) => {
    current.value = routeParams(destination.params.connectionId, destination.params.threadId);
  });
  const router = {
    get currentThread() {
      return current.value;
    },
    prefetch: jest.fn(),
    push,
    navigate: push,
    dismissTo: jest.fn(),
    link: (href: V1ThreadDestination) => ({ dismissTo: false, href }),
    searchSelectionMode: "push" as const,
    replace: jest.fn(),
    dismissToAll: jest.fn(),
  };
  const dismiss = jest.spyOn(KeyboardController, "dismiss");
  const { result, rerender } = renderHook(() =>
    useThreadNavigationService(
      {
        observeThread,
        searchConversation: async () => ({ messages: [], turns: [], older: null, newer: null }),
      },
      router,
    ),
  );
  const select = result.current.selectThread;
  act(() => select(threadSelectionKey({ serverId: "server", id: "chat" })));
  expect(push).toHaveBeenCalledWith({
    pathname: "/threads/[connectionId]/[threadId]",
    params: { connectionId: "server", threadId: "chat" },
  });
  expect(observeThread).toHaveBeenCalledWith("server", "chat");
  expect(dismiss).toHaveBeenCalledWith({ animated: false, keepFocus: false });
  rerender({});
  expect(result.current.selectThread).toBe(select);
  await act(async () => observation.resolve());
});

it("ignores project completion from a replaced conversation activation", async () => {
  const change = pending();
  const onChange = jest.fn(() => change.promise);
  const { result, rerender } = renderHook(
    ({ scope }) => {
      const owner = useConversationOwner(scope);
      return useComposerProjectSelection(scope, onChange, jest.fn(), owner);
    },
    { initialProps: { scope: "first" } },
  );
  act(() => result.current.openProjectPicker());
  let completion: Promise<void> = Promise.resolve();
  act(() => {
    completion = result.current.selectProject("/project");
  });
  expect(result.current.projectChangeBusy).toBe(true);
  rerender({ scope: "second" });
  act(() => result.current.openProjectPicker());
  expect(result.current.projectPickerVisible).toBe(true);
  expect(result.current.projectChangeBusy).toBe(false);
  await act(async () => {
    change.resolve();
    await completion;
  });
  expect(result.current.projectPickerVisible).toBe(true);
  expect(result.current.projectChangeBusy).toBe(false);
  expect(result.current.projectChangeError).toBeNull();
});
