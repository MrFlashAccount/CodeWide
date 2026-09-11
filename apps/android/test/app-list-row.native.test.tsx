import { fireEvent, render } from "@testing-library/react-native";
import { clip, Shapes } from "@expo/ui/jetpack-compose/modifiers";
import type { ReactNode } from "react";
import { Pressable, Text } from "react-native";
import { AppListRow } from "../src/ui/AppListRow.android";
import { listRowHeight } from "../src/ui/AppListRow.types";
import { iconSize, radii } from "../src/theme";

// WHY: Jest cannot mount Expo Compose view managers. Preserve the real adapter and
// modifier dispatch; replace only external native hosts with React Native hosts.
jest.mock("@expo/ui/jetpack-compose", () => {
  const Native = jest.requireActual<typeof import("react-native")>("react-native");
  interface MockContainerProps {
    children?: ReactNode;
  }
  interface MockItemProps extends MockContainerProps {
    modifiers: { $type: string; eventListener?: () => void }[];
  }
  const Slot = (props: MockContainerProps) => <Native.View>{props.children}</Native.View>;
  const Host = (props: MockContainerProps) => <Native.View {...props} testID="native-list-host" />;
  const Icon = (props: { source: unknown; tint: string; size: number }) => (
    <Native.View {...props} testID="compose-icon" />
  );
  const CircularProgressIndicator = (props: {
    modifiers: { $type: string; width?: number; height?: number }[];
  }) => {
    const dimensions = props.modifiers.find((modifier) => modifier.$type === "size");
    return (
      <Native.View
        testID="compose-progress"
        style={{ width: dimensions?.width, height: dimensions?.height }}
      />
    );
  };
  const Item = (props: MockItemProps) => (
    <Native.Pressable
      testID="native-list-item"
      dataSet={{ modifiers: JSON.stringify(props.modifiers) }}
      onPress={() =>
        props.modifiers.find((modifier) => modifier.$type === "clickable")?.eventListener?.()
      }
    >
      {props.children}
    </Native.Pressable>
  );
  return {
    Box: Slot,
    Host,
    Icon,
    CircularProgressIndicator,
    Row: Slot,
    Text: Native.Text,
    ListItem: Object.assign(Item, {
      HeadlineContent: Slot,
      SupportingContent: Slot,
      LeadingContent: Slot,
      TrailingContent: Slot,
    }),
  };
});

it("keeps custom accessory rows entirely in RN without embedding native islands", () => {
  const view = render(
    <AppListRow
      title="Buddy"
      description="Connected"
      leading={<Text>Server icon</Text>}
      descriptionLeading={<Text>Lock</Text>}
      trailing={<Text>Open</Text>}
    />,
  );
  expect(view.queryByTestId("native-list-host")).toBeNull();
  expect(view.getByText("Server icon")).toBeVisible();
  expect(view.getByText("Lock")).toBeVisible();
  expect(view.getByText("Open")).toBeVisible();
  expect(view.getByText("Buddy")).toBeVisible();
  expect(view.getByText("Connected")).toBeVisible();
});

it("uses the latest callback when a virtual cell is reused and disables activation", () => {
  const first = jest.fn();
  const second = jest.fn();
  const view = render(<AppListRow title="First file" description="User · file" onPress={first} />);
  fireEvent.press(view.getByTestId("native-list-item"));
  expect(first).toHaveBeenCalledTimes(1);
  view.rerender(<AppListRow title="Second file" onPress={second} />);
  expect(view.queryByText("User · file")).toBeNull();
  fireEvent.press(view.getByTestId("native-list-item"));
  expect(second).toHaveBeenCalledTimes(1);
  expect(first).toHaveBeenCalledTimes(1);
  view.rerender(<AppListRow title="Second file" disabled onPress={second} />);
  fireEvent.press(view.getByTestId("native-list-item"));
  expect(second).toHaveBeenCalledTimes(1);
});

it.each([listRowHeight.single, listRowHeight.double])(
  "keeps exact virtual-cell geometry at height %s without waiting for native measurement",
  (fixedHeight) => {
    const title = "A very long filename ".repeat(30);
    const view = render(
      <AppListRow testID="file" title={title} fixedHeight={fixedHeight} position="first" />,
    );
    expect(view.getByTestId("file")).toHaveStyle({ height: fixedHeight });
    expect(view.getByTestId("native-list-host")).toHaveStyle({ height: fixedHeight });
    expect(view.getByTestId("native-list-host").props.matchContents).toEqual({ vertical: false });
    expect(view.getByTestId("file").props.accessibilityLabel).toBe(title);
    expect(view.getByText(title).props.maxLines).toBe(1);
  },
);

it("clips the Compose surface to the grouped bottom corners of the last row", () => {
  const view = render(<AppListRow title="Last option" position="last" />);
  const modifiers = view.getByTestId("native-list-item").props.dataSet.modifiers;
  expect(modifiers).toContain(
    JSON.stringify(
      clip(Shapes.RoundedCorner({ bottomStart: radii.medium, bottomEnd: radii.medium })),
    ),
  );
});

it("keeps secondary actions separate and exposes selection and the description accessory", () => {
  const open = jest.fn();
  const secondary = jest.fn();
  const view = render(
    <AppListRow
      title="Server"
      description="localhost"
      selected
      onPress={open}
      descriptionLeading={<Text>Secure connection</Text>}
      trailing={
        <Pressable accessibilityRole="button" accessibilityLabel="Row actions" onPress={secondary}>
          <Text>Menu</Text>
        </Pressable>
      }
    />,
  );
  expect(view.getByText("checkmark")).toBeVisible();
  expect(view.getByText("Secure connection")).toBeVisible();
  expect(view.getByRole("radio", { name: "Server", checked: true })).toBeVisible();
  fireEvent.press(view.getByRole("button", { name: "Row actions" }));
  expect(secondary).toHaveBeenCalledTimes(1);
  expect(open).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole("radio", { name: "Server", checked: true }));
  expect(open).toHaveBeenCalledTimes(1);
});

it("exposes primary and secondary custom-row buttons as separate labelled targets", () => {
  const open = jest.fn();
  const pin = jest.fn();
  const view = render(
    <AppListRow
      title="Folder"
      accessibilityLabel="Open folder"
      onPress={open}
      trailing={
        <Pressable accessibilityRole="button" accessibilityLabel="Pin folder" onPress={pin}>
          <Text>Pin</Text>
        </Pressable>
      }
    />,
  );
  fireEvent.press(view.getByRole("button", { name: "Open folder" }));
  expect(open).toHaveBeenCalledTimes(1);
  expect(pin).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole("button", { name: "Pin folder" }));
  expect(pin).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledTimes(1);
});

it("renders display-only accessories and selection inside one Compose row", () => {
  const open = jest.fn();
  const view = render(
    <AppListRow
      title="Project"
      description="Local folder"
      selected
      onPress={open}
      leadingIcon={{ name: "folder-outline", size: 24, color: "#123456" }}
      descriptionIcon={{ name: "lock-closed", size: 14 }}
      trailingIcon={{ name: "chevron-forward" }}
    />,
  );
  expect(view.getAllByTestId("native-list-host")).toHaveLength(1);
  expect(view.getAllByTestId("compose-icon")).toHaveLength(4);
  expect(view.getAllByTestId("compose-icon")[0]?.props).toMatchObject({
    size: 24,
    tint: "#123456",
  });
  expect(view.getByRole("radio", { name: "Project", checked: true })).toBeVisible();
  fireEvent.press(view.getByTestId("native-list-item"));
  expect(open).toHaveBeenCalledTimes(1);
});

it("replaces native progress with the resolved accessory when a cell is recycled", () => {
  const view = render(<AppListRow title="Project" trailingBusy onPress={() => {}} />);
  expect(view.getByTestId("compose-progress")).toBeVisible();
  expect(view.getByTestId("compose-progress")).toHaveStyle({
    width: iconSize.inline,
    height: iconSize.inline,
  });
  expect(view.getByRole("button", { name: "Project", busy: true })).toBeVisible();
  view.rerender(
    <AppListRow title="Project" trailingIcon={{ name: "chevron-forward" }} onPress={() => {}} />,
  );
  expect(view.queryByTestId("compose-progress")).toBeNull();
  expect(view.getAllByTestId("compose-icon")).toHaveLength(1);
  expect(view.getByRole("button", { name: "Project", busy: false })).toBeVisible();
});

it("preserves fixed dimensions and updates actions when custom content changes", () => {
  const first = jest.fn();
  const second = jest.fn();
  const view = render(
    <AppListRow
      testID="row"
      title="First"
      fixedHeight={72}
      selected
      leading={<Text>Avatar</Text>}
      onPress={first}
    />,
  );
  expect(view.getByTestId("row")).toHaveStyle({ height: 72 });
  fireEvent.press(view.getByText("First"));
  view.rerender(
    <AppListRow
      testID="row"
      title="Second"
      fixedHeight={72}
      selected
      leading={<Text>Avatar 2</Text>}
      onPress={second}
    />,
  );
  fireEvent.press(view.getByText("Second"));
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  expect(view.queryByTestId("native-list-host")).toBeNull();
  expect(view.getByRole("radio", { name: "Second", checked: true })).toBeVisible();
});
