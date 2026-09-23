import { fireEvent, render } from "@testing-library/react-native";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Text } from "react-native";

import { ContentMenu as AppPopover } from "../src/ui/ContentMenu.android";
import { useEvent } from "../src/react/useEvent";
import { radii, spacing } from "../src/theme";

// WHY: Jest has no Expo Compose view registry. Replace only the external native
// adapter; the actual shell owns state, trigger composition and body lifetime.
jest.mock("@expo/ui/jetpack-compose", () => {
  const NativeView = require("react-native").View;
  const React = require("react");
  const Menu = (props: {
    children: ReactNode;
    expanded: boolean;
    cornerRadius: number;
    onDismissRequest(): void;
  }) => React.createElement(NativeView, { ...props, testID: "compose-menu" }, props.children);
  Menu.Trigger = NativeView;
  Menu.Items = NativeView;
  return { Host: NativeView, RNHostView: NativeView, DropdownMenu: Menu };
});

// WHY: The modifier entrypoint imports native Expo internals unavailable in Jest.
jest.mock("@expo/ui/jetpack-compose/modifiers", () => ({
  width: (value: number) => ({ width: value }),
}));

it("keeps its anchor mounted and forwards open, dismissal, live data and body actions", () => {
  const mounted = jest.fn();
  const originalPress = jest.fn();
  const bodyAction = jest.fn();
  function Anchor(props: { onPress?(): void }) {
    useEffect(() => {
      mounted();
    }, []);
    return (
      <Pressable accessibilityLabel="Open usage" onPress={props.onPress}>
        <Text>Usage</Text>
      </Pressable>
    );
  }
  function Example(props: { value: string; width: number }) {
    const [open, setOpen] = useState(false);
    const openPopover = useEvent(() => {
      originalPress();
      setOpen(true);
    });
    return (
      <AppPopover
        open={open}
        onOpenChange={setOpen}
        width={props.width}
        trigger={<Anchor onPress={openPopover} />}
      >
        <Text>{props.value}</Text>
        <Pressable accessibilityLabel="Body action" onPress={bodyAction}>
          <Text>Expand details</Text>
        </Pressable>
      </AppPopover>
    );
  }
  const result = render(<Example value="10 tokens" width={300} />);
  expect(result.queryByText("10 tokens")).toBeNull();
  fireEvent.press(result.getByLabelText("Open usage"));
  expect(originalPress).toHaveBeenCalledTimes(1);
  expect(result.getByTestId("compose-menu").props.expanded).toBe(true);
  expect(result.getByTestId("compose-menu").props.cornerRadius).toBe(radii.menu);
  expect(radii.menu - radii.selected).toBe(spacing.xs);
  expect(result.getByText("10 tokens")).toBeVisible();
  fireEvent.press(result.getByLabelText("Body action"));
  expect(bodyAction).toHaveBeenCalledTimes(1);
  result.rerender(<Example value="20 tokens" width={260} />);
  expect(result.getByText("20 tokens")).toBeVisible();
  fireEvent(result.getByTestId("compose-menu"), "dismissRequest");
  expect(result.queryByText("20 tokens")).toBeNull();
  expect(mounted).toHaveBeenCalledTimes(1);
});
