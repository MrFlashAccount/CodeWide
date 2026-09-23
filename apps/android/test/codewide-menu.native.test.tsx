import { fireEvent, render, within } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Image, Text } from "react-native";

import { CodeWideMenu } from "../src/ui/CodeWideMenu.native";

// WHY: Compose slots cannot mount in Node. Replace only the Expo native host;
// exercise the real menu's selection updates and action dispatch across renders.
jest.mock("@expo/ui/jetpack-compose", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const Host = (props: { children?: ReactNode }) => <View>{props.children}</View>;
  const RNHostView = (props: { children?: ReactNode }) => (
    <View testID="rn-bridge">{props.children}</View>
  );
  return {
    Host,
    RNHostView,
    DropdownMenu: Object.assign(Host, { Trigger: Host, Items: Host }),
  };
});
jest.mock("@expo/ui/jetpack-compose/modifiers", () => ({
  width: jest.fn(),
}));

it.each([{ label: "legacy", Menu: CodeWideMenu }])(
  "$label moves selection without remounting menu rows",
  ({ Menu }) => {
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
    const first = view.getByRole("menuitem", { name: /Model A/ });
    const second = view.getByRole("menuitem", { name: /Model B/ });
    expect(view.getAllByTestId("rn-bridge")).toHaveLength(2);
    expect(view.getAllByText("checkmark")).toHaveLength(1);
    expect(first.props.accessibilityState.selected).toBe(true);
    expect(within(first).getByText("checkmark")).toBeOnTheScreen();
    expect(within(second).queryByText("checkmark")).toBeNull();
    fireEvent.press(second);
    expect(select).toHaveBeenCalledWith("model-b");
    view.rerender(menu("model-b"));
    expect(view.getByRole("menuitem", { name: /Model A/ })).toBe(first);
    expect(view.getByRole("menuitem", { name: /Model B/ })).toBe(second);
    expect(view.getAllByText("checkmark")).toHaveLength(1);
    expect(within(first).queryByText("checkmark")).toBeNull();
    expect(second.props.accessibilityState.selected).toBe(true);
    expect(within(second).getByText("checkmark")).toBeOnTheScreen();
    view.rerender(menu("model-a"));
    expect(view.getAllByText("checkmark")).toHaveLength(1);
    expect(within(first).getByText("checkmark")).toBeOnTheScreen();
    expect(within(second).queryByText("checkmark")).toBeNull();
    view.rerender(menu("none"));
    expect(view.queryByText("checkmark")).toBeNull();
  },
);

it.each([{ label: "legacy", Menu: CodeWideMenu }])(
  "$label restores RN named icons while preserving image-source icons",
  ({ Menu }) => {
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
    const icons = view.UNSAFE_getAllByType(Image);
    expect(icons).toHaveLength(1);
    expect(icons[0]?.props.source).toBe(imageSource);
  },
);

it.each([{ label: "legacy", Menu: CodeWideMenu }])(
  "$label preserves an Ionicons name outside the Compose inventory",
  ({ Menu }) => {
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
    expect(view.UNSAFE_queryAllByType(Image)).toHaveLength(0);
  },
);
