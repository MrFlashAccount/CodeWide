import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { LegendList } from "@legendapp/list/react-native";
import type { ReactNode } from "react";
import { ProjectPickerSheet } from "../src/features/projects/ProjectPickerSheet";
import { AppListRow } from "../src/ui/AppListRow";
import { listRowHeight } from "../src/ui/AppListRow.types";

// WHY: The native Compose sheet and list hosts are unavailable in Node; project navigation stays real.
jest.mock("@expo/ui/jetpack-compose", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const {
    Pressable: NativePressable,
    Text: NativeText,
    View,
  } = jest.requireActual<typeof import("react-native")>("react-native");
  const Host = ({ children }: { readonly children?: ReactNode }) => <View>{children}</View>;
  const Slot = ({ children }: { readonly children?: ReactNode }) => <View>{children}</View>;
  const ListItem = Object.assign(Slot, {
    HeadlineContent: Slot,
    LeadingContent: Slot,
    SupportingContent: Slot,
    TrailingContent: Slot,
  });
  const ModalBottomSheet = React.forwardRef(function MockModalBottomSheet(
    { children }: { readonly children?: ReactNode },
    ref,
  ) {
    React.useImperativeHandle(ref, () => ({ hide: async () => undefined }), []);
    return <View>{children}</View>;
  });
  return {
    Box: Slot,
    CircularProgressIndicator: Slot,
    Host,
    Icon: Slot,
    ListItem,
    ModalBottomSheet,
    NativePressable,
    RNHostView: Host,
    Row: Slot,
    Text: NativeText,
  };
});

// WHY: Non-Android resolution still requires the external community sheet to be inert in Node.
jest.mock("@expo/ui/community/bottom-sheet", () => {
  const { View, ScrollView } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    BottomSheet: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    BottomSheetView: View,
    BottomSheetScrollView: ScrollView,
  };
});

const homePath = "/srv/remote-user";
function TestProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
const entry = (fileName: string) => ({ fileName, isDirectory: true, isFile: false });
const defaults = {
  visible: true,
  browseOnly: true,
  cwd: "/deleted/history/project",
  projects: [],
  discoveredProjects: [],
  busy: false,
  error: null,
  onClose: jest.fn(),
  onSelect: jest.fn(async () => undefined),
};

it("opens server Home, navigates folders and adds only the selected directory", async () => {
  const readHome = jest.fn(async () => homePath);
  const readDirectory = jest.fn(async (path: string) =>
    path === homePath ? [entry("Projects")] : [],
  );
  const add = jest.fn(async (path: string) => ({
    path,
    name: "Projects",
    addedAt: 1,
    lastUsedAt: 1,
    pinned: true,
  }));
  const select = jest.fn(async () => undefined);
  const view = render(
    <ProjectPickerSheet
      {...defaults}
      onReadHomeDirectory={readHome}
      onReadDirectory={readDirectory}
      onAddProject={add}
      onSelect={select}
    />,
    { wrapper: TestProvider },
  );
  await waitFor(() => expect(view.getByText("Projects")).toBeVisible());
  expect(view.UNSAFE_getByType(LegendList).props.recycleItems).toBe(true);
  const folders = view.UNSAFE_getByType(LegendList);
  expect(folders.props.getFixedItemSize(folders.props.data[0], 0)).toBe(listRowHeight.single);
  expect(view.UNSAFE_getByType(AppListRow).props.fixedHeight).toBe(listRowHeight.single);
  expect(readDirectory).toHaveBeenCalledWith(homePath);
  expect(readDirectory).not.toHaveBeenCalledWith(defaults.cwd);
  fireEvent.press(view.getByText("Projects"));
  await waitFor(() => expect(view.getByText("This folder has no subfolders")).toBeVisible());
  fireEvent.press(view.getByText("Add this folder"));
  await waitFor(() => expect(select).toHaveBeenCalledWith(`${homePath}/Projects`));
  expect(add).toHaveBeenCalledWith(`${homePath}/Projects`);
  expect(readHome).toHaveBeenCalledTimes(1);
});

it("virtualizes every project as an independent recyclable row", () => {
  const projects = Array.from({ length: 100 }, (_, index) => ({
    addedAt: index,
    lastUsedAt: index,
    name: `Project ${index}`,
    path: `/workspace/project-${index}`,
    pinned: true,
  }));
  const view = render(<ProjectPickerSheet {...defaults} browseOnly={false} projects={projects} />, {
    wrapper: TestProvider,
  });
  const list = view.UNSAFE_getByType(LegendList);
  expect(list.props.recycleItems).toBe(true);
  for (const item of list.props.data) {
    if (item.kind === "project")
      expect(list.props.getFixedItemSize(item)).toBe(listRowHeight.double);
  }
  for (const row of view.UNSAFE_getAllByType(AppListRow)) {
    expect(row.props.fixedHeight).toBe(listRowHeight.double);
    expect(row.props.multiline).not.toBe(true);
  }
  expect(list.props.data.filter((item: { kind: string }) => item.kind === "project")).toHaveLength(
    100,
  );
});

it("keeps a discovered project's secondary Pin action independent from row selection", async () => {
  const discovered = {
    addedAt: 1,
    lastUsedAt: 1,
    name: "Discovered project",
    path: "/workspace/discovered",
    pinned: false,
  };
  let settle: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const add = jest.fn(async () => {
    await pending;
    return { ...discovered, pinned: true };
  });
  const select = jest.fn(async () => undefined);
  const view = render(
    <ProjectPickerSheet
      {...defaults}
      browseOnly={false}
      discoveredProjects={[discovered]}
      onAddProject={add}
      onSelect={select}
    />,
    { wrapper: TestProvider },
  );
  fireEvent.press(view.getByLabelText("Pin Discovered project"));
  expect(add).toHaveBeenCalledWith(discovered.path);
  expect(select).not.toHaveBeenCalled();
  expect(view.getByLabelText("Pin Discovered project")).toBeDisabled();
  await act(async () => {
    settle();
    await pending;
  });
  expect(view.getByLabelText("Pin Discovered project")).toBeEnabled();
  expect(select).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText("Discovered project"));
  expect(select).toHaveBeenCalledWith(discovered.path);
});

it("does not show an empty folder during Home loading or a failed listing, and returns Home", async () => {
  let resolveHome: (path: string) => void = () => undefined;
  const readHome = () =>
    new Promise<string>((resolve) => {
      resolveHome = resolve;
    });
  const readDirectory = jest.fn(async (path: string) => {
    if (path !== homePath) throw new Error("Folder is no longer available");
    return [entry("Deleted")];
  });
  const add = jest.fn(async (path: string) => ({
    path,
    name: "Home",
    addedAt: 1,
    lastUsedAt: 1,
    pinned: true,
  }));
  const view = render(
    <ProjectPickerSheet
      {...defaults}
      onReadHomeDirectory={readHome}
      onReadDirectory={readDirectory}
      onAddProject={add}
    />,
    { wrapper: TestProvider },
  );
  expect(view.queryByText("This folder has no subfolders")).toBeNull();
  expect(readDirectory).not.toHaveBeenCalled();
  await act(async () => {
    await Promise.resolve();
    resolveHome(homePath);
  });
  await waitFor(() => expect(view.getByText("Deleted")).toBeVisible());
  fireEvent.press(view.getByText("Deleted"));
  await waitFor(() =>
    expect(view.getByRole("alert")).toHaveTextContent("Folder is no longer available"),
  );
  expect(view.queryByText("This folder has no subfolders")).toBeNull();
  fireEvent.press(view.getByText("Add this folder"));
  expect(add).not.toHaveBeenCalled();
  fireEvent.press(view.getByText("Go to Home"));
  await waitFor(() => expect(view.getByText("Deleted")).toBeVisible());
  expect(view.queryByRole("alert")).toBeNull();
});

it("keeps Home separate from parent navigation and the filesystem root", async () => {
  const readDirectory = jest.fn(async () => []);
  const view = render(
    <ProjectPickerSheet
      {...defaults}
      onReadHomeDirectory={async () => homePath}
      onReadDirectory={readDirectory}
    />,
    { wrapper: TestProvider },
  );
  await waitFor(() => expect(readDirectory).toHaveBeenLastCalledWith(homePath));
  fireEvent.press(view.getByLabelText("Parent directory"));
  await waitFor(() => expect(readDirectory).toHaveBeenLastCalledWith("/srv"));
  fireEvent.press(view.getByLabelText("Parent directory"));
  await waitFor(() => expect(readDirectory).toHaveBeenLastCalledWith("/"));
  expect(view.getByLabelText("Parent directory")).toBeDisabled();
  fireEvent.press(view.getByLabelText("Home directory"));
  await waitFor(() => expect(view.getByLabelText(`Open directory ${homePath}`)).toBeVisible());
  expect(readDirectory).not.toHaveBeenCalledWith(defaults.cwd);
});

it("does not substitute a history path when the server cannot resolve Home", async () => {
  const readDirectory = jest.fn(async () => []);
  const view = render(
    <ProjectPickerSheet
      {...defaults}
      onReadHomeDirectory={async () => {
        throw new Error("Home unavailable");
      }}
      onReadDirectory={readDirectory}
    />,
    { wrapper: TestProvider },
  );
  await waitFor(() => expect(view.getByRole("alert")).toHaveTextContent("Home unavailable"));
  expect(readDirectory).not.toHaveBeenCalled();
  expect(view.queryByText("This folder has no subfolders")).toBeNull();
  expect(view.getByText("Add this folder")).toBeDisabled();
});
