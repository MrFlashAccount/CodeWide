import { fireEvent, render } from "@testing-library/react-native";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Text } from "react-native";

import { ContentMenu as AppPopover } from "../src/ui/ContentMenu.android";
import { useEvent } from "../src/react/useEvent";
import { radii, spacing } from "../src/theme";
import { layOutContentMenus } from "./fixtures/contentMenuLayout";

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
  height: (value: number) => ({ height: value }),
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
  layOutContentMenus(result);
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

it("sizes the popup to its laid-out body between its height bounds and opens once it is known", () => {
  function Example(props: { readonly maxHeight?: number; readonly minHeight?: number }) {
    const [open, setOpen] = useState(false);
    const press = useEvent(() => {
      setOpen(true);
    });
    return (
      <AppPopover
        open={open}
        onOpenChange={setOpen}
        width={300}
        {...(props.maxHeight === undefined ? {} : { maxHeight: props.maxHeight })}
        {...(props.minHeight === undefined ? {} : { minHeight: props.minHeight })}
        trigger={
          <Pressable accessibilityLabel="Open list" onPress={press}>
            <Text>List</Text>
          </Pressable>
        }
      >
        <Text>Rows</Text>
      </AppPopover>
    );
  }
  const view = render(<Example maxHeight={300} minHeight={80} />);
  fireEvent.press(view.getByLabelText("Open list"));

  // The body is laid out to be measured before the native popup opens.
  expect(view.getByTestId("compose-menu").props.expanded).toBe(false);
  layOutContentMenus(view, 180);
  expect(view.getByTestId("compose-menu").props.expanded).toBe(true);
  expect(view.getByTestId("content-menu")).toHaveStyle({ height: 180, width: 300 });

  // The body grows inside the open menu, up to its bound, then scrolls.
  layOutContentMenus(view, 900);
  expect(view.getByTestId("content-menu")).toHaveStyle({ height: 300 });
  layOutContentMenus(view, 20);
  expect(view.getByTestId("content-menu")).toHaveStyle({ height: 80 });
});
