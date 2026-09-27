import { fireEvent, render } from "@testing-library/react-native";
import { useState, type ReactNode } from "react";
import { View } from "react-native";

import type { ServerIconId } from "../src/data/serverIcons";
import { ServerIconPicker } from "../src/features/connections/ServerIconPicker";
import { touchTarget } from "../src/theme";

jest.mock("@expo/ui/jetpack-compose", () => {
  const NativeView = require("react-native").View;
  const Menu = (props: { children: ReactNode; expanded: boolean; onDismissRequest(): void }) => (
    <NativeView {...props} testID="server-icon-menu" />
  );
  Menu.Trigger = NativeView;
  Menu.Items = NativeView;
  return { DropdownMenu: Menu, Host: NativeView, RNHostView: NativeView };
});

jest.mock("@expo/ui/jetpack-compose/modifiers", () => ({
  width: (value: number) => ({ width: value }),
}));

function PickerExample(): React.JSX.Element {
  const [iconId, setIconId] = useState<ServerIconId>("desktop");
  return (
    <View>
      <ServerIconPicker
        accessibilityLabel="Choose server icon"
        iconId={iconId}
        onSelect={setIconId}
      />
    </View>
  );
}

it("opens an anchored icon grid, exposes selection and chooses directly in the popover", () => {
  const view = render(<PickerExample />);
  const trigger = view.getByRole("button", {
    name: "Choose server icon. Selected: Desktop",
  });
  expect(trigger).toHaveStyle({ height: touchTarget, width: touchTarget });
  expect(trigger.props.accessibilityState).toEqual({ expanded: false });

  fireEvent.press(trigger);
  expect(view.getByTestId("server-icon-menu").props.expanded).toBe(true);
  const options = view.getAllByRole("radio");
  expect(options.length).toBeGreaterThanOrEqual(16);
  expect(
    view.getByRole("radio", { name: "Server icon: Desktop" }).props.accessibilityState,
  ).toEqual({ checked: true, selected: true });

  fireEvent.press(view.getByRole("radio", { name: "Server icon: Server" }));
  expect(view.getByTestId("server-icon-menu").props.expanded).toBe(false);
  expect(view.getByText("server-outline")).toBeTruthy();
});
