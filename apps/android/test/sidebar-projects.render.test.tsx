import { LegendList } from "@legendapp/list/react-native";
import { act, fireEvent, within } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { useState } from "react";
import { Text, View } from "react-native";
import {
  SidebarProjectHeader,
  SidebarProjectRow,
  SidebarProjectsSheet,
} from "../src/features/projects/SidebarProjects";
import { AppListRow } from "../src/ui/AppListRow";
import { listRowHeight } from "../src/ui/AppListRow.types";
import { colors } from "../src/theme";
import { management, project, render } from "./sidebar-projects.fixture";

// WHY: Node cannot mount the native bottom-sheet window. Keep the product
// navigation and selection controls real; substitute only Expo's native host.
jest.mock("@expo/ui/community/bottom-sheet", () => {
  const { View, ScrollView } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    BottomSheet: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    BottomSheetView: View,
    BottomSheetScrollView: ScrollView,
  };
});
function ProjectNavigation() {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Text>Open conversation stays here</Text>
      {open ? (
        <SidebarProjectHeader
          project={project}
          serverName="Buddy"
          archived={false}
          onBack={() => setOpen(false)}
          onRoot={() => setOpen(false)}
        />
      ) : (
        <SidebarProjectRow project={project} onPress={() => setOpen(true)} />
      )}
    </View>
  );
}

it("opens project breadcrumbs without archive tabs and returns without removing the conversation", () => {
  const view = render(<ProjectNavigation />);
  expect(view.getByTestId(`project-unread:${project.key}`)).toBeVisible();
  fireEvent.press(view.getByLabelText("Open project Repo, unread chats"));
  expect(view.getByText("Buddy")).toBeVisible();
  expect(view.getByText("\\")).toBeVisible();
  expect(view.getByLabelText("Project Repo")).toBeVisible();
  expect(view.queryAllByRole("tab")).toHaveLength(0);
  expect(view.queryByText("Archive")).toBeNull();
  expect(view.getByText("Open conversation stays here")).toBeVisible();
  fireEvent.press(view.getByLabelText("Back to projects"));
  expect(view.getByLabelText("Open project Repo, unread chats")).toBeVisible();
});

it("keeps project-archive back navigation separate from the server breadcrumb", () => {
  const back = jest.fn();
  const root = jest.fn();
  const view = render(
    <SidebarProjectHeader
      project={project}
      serverName="Buddy"
      archived
      onBack={back}
      onRoot={root}
    />,
  );
  expect(view.getByText("\\ Archive")).toBeVisible();
  expect(view.getByLabelText("Project Repo")).toBeVisible();
  fireEvent.press(view.getByLabelText("Back to project chats"));
  expect(back).toHaveBeenCalledTimes(1);
  expect(root).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText("Back to Buddy projects"));
  expect(root).toHaveBeenCalledTimes(1);
  expect(view.queryAllByRole("tab")).toHaveLength(0);
});

it("removes only the unread dot when the last unread chat is read", () => {
  const view = render(<SidebarProjectRow project={project} onPress={jest.fn()} />);
  view.rerender(<SidebarProjectRow project={{ ...project, unread: false }} onPress={jest.fn()} />);
  expect(view.queryByTestId(`project-unread:${project.key}`)).toBeNull();
  expect(view.getByLabelText("Open project Repo")).toBeVisible();
});

it("uses a single compact project row without a path or navigation chevron", () => {
  const open = jest.fn();
  const view = render(<SidebarProjectRow project={project} onPress={open} />);
  expect(view.queryByText("/repo")).toBeNull();
  expect(view.queryByText("chevron-forward")).toBeNull();
  expect(view.getByLabelText("Open project Repo, unread chats")).toHaveStyle({
    height: 48,
    minHeight: 48,
    marginHorizontal: 8,
  });
  fireEvent.press(view.getByLabelText("Open project Repo, unread chats"));
  expect(open).toHaveBeenCalledTimes(1);
  view.rerender(
    <SidebarProjectRow project={{ ...project, serverLabel: "Buddy" }} onPress={open} />,
  );
  expect(view.getByText("· Buddy", { exact: false })).toBeVisible();
  expect(view.getByLabelText("Open project Repo, Buddy, unread chats")).toBeVisible();
  expect(view.queryByText("/repo")).toBeNull();
});

it("keeps a failed pin update visible instead of pretending it was saved", async () => {
  const toggle = jest.fn(async () => {
    throw new Error("Server is offline");
  });
  const view = render(
    <SidebarProjectsSheet
      {...management}
      visible
      projects={[project]}
      errors={[]}
      onToggle={toggle}
      onClose={jest.fn()}
    />,
  );
  fireEvent.press(view.getByLabelText("Actions for Repo, /repo"));
  fireEvent.press(view.getByLabelText("Actions for Repo, /repo: Unpin project"));
  expect(await view.findByText("Server is offline")).toBeVisible();
  expect(view.getByLabelText("Actions for Repo, /repo")).toBeEnabled();
  expect(view.getByText("Pinned")).toBeVisible();
  expect(view.getByText("Repo")).toBeVisible();
  expect(toggle).toHaveBeenCalledWith(project);
});

it("offers durable reordering without moving the first or last project outside the list", async () => {
  const move = jest.fn(async () => undefined);
  const second = {
    ...project,
    key: "server:/second",
    path: "/second",
    subtitle: "/second",
    name: "Second",
  };
  const view = render(
    <SidebarProjectsSheet
      {...management}
      visible
      projects={[project, second]}
      errors={[]}
      onToggle={jest.fn()}
      onMove={move}
      onClose={jest.fn()}
    />,
  );
  expect(view.getByText("Manage Projects")).toBeVisible();
  expect(view.queryAllByRole("checkbox")).toHaveLength(0);
  expect(view.queryByText("Move up")).toBeNull();
  fireEvent.press(view.getByLabelText("Actions for Repo, /repo"));
  expect(view.getByLabelText("Actions for Repo, /repo: Move up")).toBeDisabled();
  fireEvent.press(view.getByLabelText("Actions for Repo, /repo: Move down"));
  expect(move).toHaveBeenCalledWith(project, 1);
  expect(
    await view.findByRole("button", { name: "Actions for Repo, /repo", disabled: false }),
  ).toBeVisible();
  fireEvent.press(view.getByLabelText("Actions for Second, /second"));
  expect(view.getByLabelText("Actions for Second, /second: Move down")).toBeDisabled();
});

it("separates pinned order from recent activity and keeps other projects available", () => {
  const discovered = Array.from({ length: 10 }, (_, index) => ({
    ...project,
    key: `server:/${index}`,
    path: `/${index}`,
    subtitle: `/${index}`,
    name: `History ${index}`,
    pinned: false,
    lastUsedAt: index,
  }));
  const second = {
    ...project,
    key: "server:/second",
    path: "/second",
    subtitle: "/second",
    name: "Second",
    lastUsedAt: 100,
  };
  const view = render(
    <SidebarProjectsSheet
      {...management}
      visible
      projects={[...discovered, project, second]}
      errors={[]}
      onToggle={jest.fn()}
      onClose={jest.fn()}
    />,
  );
  const list = within(view.getByTestId("project-management-list"));
  expect(list.getAllByRole("button").map((row) => row.props.accessibilityLabel)).toEqual([
    "Actions for Repo, /repo",
    "Actions for Second, /second",
    "Recent projects, 8",
    ...[9, 8, 7, 6, 5, 4, 3, 2].map((index) => `Actions for History ${index}, /${index}`),
    "Other projects, 2",
  ]);
  expect(list.queryByText("History 1")).toBeNull();
  fireEvent.press(list.getByLabelText("Other projects, 2"));
  expect(list.getByText("History 1")).toBeVisible();
  expect(list.getByText("History 0")).toBeVisible();
  fireEvent.press(list.getByLabelText("Recent projects, 8"));
  expect(list.queryByText("History 9")).toBeNull();
  expect(list.getByText("Repo")).toBeVisible();
});

it("leaves the header add action available for an empty list without empty sections", () => {
  const browse = jest.fn();
  const view = render(
    <SidebarProjectsSheet
      {...management}
      visible
      projects={[]}
      errors={[]}
      onToggle={jest.fn()}
      onBrowse={browse}
      onClose={jest.fn()}
    />,
  );
  const header = within(view.getByTestId("project-management-header"));
  expect(header.getByRole("header", { name: "Manage Projects" })).toBeVisible();
  expect(header.getByLabelText("Add project")).toHaveStyle({ width: 48, height: 48 });
  expect(header.getByLabelText("Add project")).not.toHaveStyle({
    backgroundColor: colors.surfaceContainer,
  });
  expect(header.getByText("add")).toHaveStyle({ fontSize: 20 });
  expect(view.queryByText("Pinned")).toBeNull();
  expect(view.queryByText("Recent")).toBeNull();
  expect(view.queryByText("Other")).toBeNull();
  fireEvent.press(header.getByLabelText("Add project"));
  expect(browse).toHaveBeenCalledWith("server");
});

it("virtualizes each project independently instead of mounting an expanded section as one item", () => {
  const projects = Array.from({ length: 100 }, (_, index) => ({
    ...project,
    key: `server:/${index}`,
    path: `/${index}`,
    subtitle: `/${index}`,
    name: `Project ${index}`,
    pinned: false,
    lastUsedAt: index,
  }));
  const view = render(
    <SidebarProjectsSheet
      {...management}
      visible
      projects={projects}
      errors={[]}
      onToggle={jest.fn()}
      onClose={jest.fn()}
    />,
  );
  // WHY: Per-project list entries are the virtualization contract. The Node
  // native-list adapter cannot simulate viewport clipping or recycled views.
  const list = view.UNSAFE_getByType(LegendList);
  for (const item of list.props.data) {
    const height = list.props.getFixedItemSize(item);
    if (item.kind === "project") expect(height).toBe(listRowHeight.double);
    if (item.kind === "section") {
      expect(view.getByTestId(`project-section:${item.section.title}`)).toHaveStyle({ height });
    }
  }
  for (const row of view.UNSAFE_getAllByType(AppListRow)) {
    expect(row.props.fixedHeight).toBe(listRowHeight.double);
  }
  expect(list.props.data.filter((item: { kind: string }) => item.kind === "project")).toHaveLength(
    8,
  );
  fireEvent.press(view.getByLabelText("Other projects, 92"));
  const expandedItems = view.UNSAFE_getByType(LegendList).props.data;
  expect(expandedItems.filter((item: { kind: string }) => item.kind === "project")).toHaveLength(
    100,
  );
  expect(expandedItems.filter((item: { kind: string }) => item.kind === "section")).toHaveLength(2);
  fireEvent.press(view.getByLabelText("Other projects, 92"));
  expect(
    view
      .UNSAFE_getByType(LegendList)
      .props.data.filter((item: { kind: string }) => item.kind === "project"),
  ).toHaveLength(8);
});

it("keeps the real project path instead of inserting a synthetic leading ellipsis", () => {
  const path = "/home/sergeigarin/Projects/CodeWide";
  const view = render(
    <SidebarProjectsSheet
      {...management}
      visible
      projects={[{ ...project, path, subtitle: path }]}
      errors={[]}
      onToggle={jest.fn()}
      onClose={jest.fn()}
    />,
  );
  expect(view.getByText(path)).toBeVisible();
  expect(view.queryByText("…/Projects/CodeWide")).toBeNull();
  expect(view.getByLabelText(`Actions for Repo, ${path}`)).toBeVisible();
});

it("keeps matching project paths on separate servers independently actionable", async () => {
  const toggle = jest.fn(async () => undefined);
  const alpha = { ...project, key: "a:/repo", connectionId: "a", subtitle: "Alpha · /repo" };
  const beta = { ...project, key: "b:/repo", connectionId: "b", subtitle: "Beta · /repo" };
  const view = render(
    <SidebarProjectsSheet
      {...management}
      visible
      projects={[alpha, beta]}
      servers={[
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
      ]}
      errors={[]}
      onToggle={toggle}
      onClose={jest.fn()}
    />,
  );
  expect(view.getByText("Alpha · /repo")).toBeVisible();
  expect(view.getByText("Beta · /repo")).toBeVisible();
  fireEvent.press(view.getByLabelText("Actions for Repo, Beta · /repo"));
  fireEvent.press(view.getByLabelText("Actions for Repo, Beta · /repo: Unpin project"));
  expect(toggle).toHaveBeenCalledWith(beta);
  expect(
    await view.findByRole("button", { name: "Actions for Repo, Beta · /repo", disabled: false }),
  ).toBeVisible();
});

it("prevents another project mutation until the current pin request settles", async () => {
  let settle: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const toggle = jest.fn(() => promise);
  const view = render(
    <SidebarProjectsSheet
      {...management}
      visible
      projects={[{ ...project, pinned: false }]}
      errors={[]}
      onToggle={toggle}
      onClose={jest.fn()}
    />,
  );
  fireEvent.press(view.getByLabelText("Actions for Repo, /repo"));
  fireEvent.press(view.getByLabelText("Actions for Repo, /repo: Pin project"));
  expect(view.getByLabelText("Actions for Repo, /repo")).toBeDisabled();
  expect(view.queryByText("ellipsis-horizontal")).toBeNull();
  expect(view.getByLabelText("Add project")).toBeDisabled();
  fireEvent.press(view.getByLabelText("Actions for Repo, /repo: Pin project"));
  expect(toggle).toHaveBeenCalledTimes(1);
  await act(async () => {
    settle();
    await promise;
  });
  expect(view.getByLabelText("Actions for Repo, /repo")).toBeEnabled();
  expect(view.getByText("ellipsis-horizontal")).toBeVisible();
});

it("browses the chosen server without changing the active conversation project", () => {
  const browse = jest.fn();
  const view = render(
    <SidebarProjectsSheet
      {...management}
      visible
      projects={[]}
      servers={[
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
      ]}
      errors={[]}
      onToggle={jest.fn()}
      onBrowse={browse}
      onClose={jest.fn()}
    />,
  );
  fireEvent.press(view.getByLabelText("Add project"));
  expect(browse).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText("Add project on Beta"));
  expect(browse).toHaveBeenCalledWith("b");
});
