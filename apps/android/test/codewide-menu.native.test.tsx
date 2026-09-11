import { fireEvent, render, within } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Text } from "react-native";

import { CodeWideMenu } from "../src/ui/CodeWideMenu.native";
import { CodeWideMenu as V2CodeWideMenu } from "../src/v2/ui/CodeWideMenu.native";
import { colors, iconSize } from "../src/theme";

// WHY: Compose slots cannot mount in Node. Replace only the Expo native host;
// exercise the real menu's selection updates and slot lifetime across renders.
jest.mock("@expo/ui/jetpack-compose", () => {
  const { View, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  const Host = (props: { children?: ReactNode }) => <View>{props.children}</View>;
  const RNHostView = (props: { children?: ReactNode }) => (
    <View testID="rn-bridge">{props.children}</View>
  );
  const Icon = (props: { source: unknown; size: number; tint: string }) => (
    <View testID="native-icon" {...props} />
  );
  const TrailingIcon = (props: { children?: ReactNode }) => (
    <View testID="selection-slot">{props.children}</View>
  );
  const Item = (props: { children?: ReactNode; onClick?(): void }) => (
    <View onTouchEnd={props.onClick}>{props.children}</View>
  );
  return {
    Box: Host,
    Column: Host,
    Host,
    HorizontalDivider: Host,
    Icon,
    RNHostView,
    Text,
    DropdownMenu: Object.assign(Host, { Trigger: Host, Items: Host }),
    DropdownMenuItem: Object.assign(Item, { Text: Host, LeadingIcon: Host, TrailingIcon }),
  };
});
jest.mock("@expo/ui/jetpack-compose/modifiers", () => ({
  size: jest.fn(),
  width: jest.fn(),
  height: jest.fn(),
  padding: jest.fn(),
}));

it.each([
  { label: "legacy", Menu: CodeWideMenu, selectedIconSize: iconSize.action },
  { label: "V2", Menu: V2CodeWideMenu, selectedIconSize: 18 },
])("$label moves selection without remounting native icon slots", ({ Menu, selectedIconSize }) => {
  const select = jest.fn();
  const menu = (selected: string) => (
    <Menu
      expanded
      onDismiss={jest.fn()}
      onSelect={select}
      actions={[
        { id: "model-a", label: "Model A", selected: selected === "model-a" },
        { id: "model-b", label: "Model B", selected: selected === "model-b" },
        { id: "other", label: "Ordinary action" },
      ]}
    >
      <Text>Models</Text>
    </Menu>
  );
  const view = render(menu("model-a"));
  const slots = view.getAllByTestId("selection-slot");
  expect(slots).toHaveLength(2);
  const first = slots[0];
  const second = slots[1];
  if (first === undefined || second === undefined) throw new Error("Missing selection slots");
  expect(view.getAllByTestId("rn-bridge")).toHaveLength(3);
  expect(view.getAllByText("checkmark")).toHaveLength(1);
  expect(within(first).getByText("checkmark")).toHaveStyle({
    color: colors.text,
    fontSize: selectedIconSize,
  });
  expect(within(second).queryByText("checkmark")).toBeNull();
  fireEvent(view.getByText("Model B"), "touchEnd");
  expect(select).toHaveBeenCalledWith("model-b");
  view.rerender(menu("model-b"));
  expect(view.getAllByTestId("selection-slot")).toEqual(slots);
  expect(view.getAllByText("checkmark")).toHaveLength(1);
  expect(within(first).queryByText("checkmark")).toBeNull();
  expect(within(second).getByText("checkmark")).toHaveStyle({
    color: colors.text,
    fontSize: selectedIconSize,
  });
  view.rerender(menu("model-a"));
  expect(view.getAllByTestId("selection-slot")).toEqual(slots);
  expect(view.getAllByText("checkmark")).toHaveLength(1);
  expect(within(first).getByText("checkmark")).toHaveStyle({
    color: colors.text,
    fontSize: selectedIconSize,
  });
  expect(within(second).queryByText("checkmark")).toBeNull();
  view.rerender(menu("none"));
  expect(view.getAllByTestId("selection-slot")).toEqual(slots);
  expect(view.queryByText("checkmark")).toBeNull();
});

it.each([
  { label: "legacy", Menu: CodeWideMenu },
  { label: "V2", Menu: V2CodeWideMenu },
])("$label restores RN named icons while preserving image-source icons", ({ Menu }) => {
  const imageSource = { uri: "https://example.invalid/icon.png" };
  const view = render(
    <Menu
      expanded
      onDismiss={jest.fn()}
      onSelect={jest.fn()}
      actions={[
        { id: "named", label: "Named icon", icon: "folder-outline" },
        { id: "source", label: "Image icon", icon: imageSource },
      ]}
    >
      <Text>Actions</Text>
    </Menu>,
  );
  expect(view.getAllByTestId("rn-bridge")).toHaveLength(2);
  expect(view.getByText("folder-outline")).toBeOnTheScreen();
  const icons = view.getAllByTestId("native-icon");
  expect(icons).toHaveLength(1);
  expect(icons[0]?.props.source).toBe(imageSource);
});

it.each([
  { label: "legacy", Menu: CodeWideMenu },
  { label: "V2", Menu: V2CodeWideMenu },
])("$label preserves an Ionicons name outside the Compose inventory", ({ Menu }) => {
  const view = render(
    <Menu
      expanded
      onDismiss={jest.fn()}
      onSelect={jest.fn()}
      actions={[{ id: "custom", label: "Custom icon", icon: "american-football-outline" }]}
    >
      <Text>Actions</Text>
    </Menu>,
  );
  expect(view.getByText("american-football-outline")).toBeOnTheScreen();
  expect(view.getAllByTestId("rn-bridge")).toHaveLength(2);
  expect(view.queryByTestId("native-icon")).toBeNull();
});
