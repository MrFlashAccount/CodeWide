import { fireEvent, render } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Text } from "react-native";

import { SettingsSheet } from "../src/features/settings/SettingsSheet";

// WHY: Node cannot host the native bottom-sheet window. Exercise the real settings
// navigation, AppSheet and list rows while replacing only the external platform surface.
jest.mock("@expo/ui/community/bottom-sheet", () => {
  const { View, ScrollView } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    BottomSheet: ({ children }: { children: ReactNode }) => <View testID="native-sheet">{children}</View>,
    BottomSheetView: View,
    BottomSheetScrollView: ScrollView,
  };
});
// WHY: The portal's native overlay host cannot be installed in the Node renderer.
jest.mock("heroui-native/portal", () => ({ PortalHost: () => null }));

function server(id: string, title: string, account: string) {
  return { id, title, description: "Connected", leading: <Text>{`${title} avatar`}</Text>, statusIcon: <Text>{`${title} status`}</Text>, content: <Text>{account}</Text> };
}

function setup() {
  return {
    servers: [server("buddy", "Buddy", "Personal account"), server("work", "Work", "Work account")],
    security: <Text>App lock</Text>,
    advanced: <Text>Performance diagnostics</Text>,
    version: <Text>Version test</Text>,
    onAddServer: jest.fn(),
    onClose: jest.fn(),
  };
}

it("opens only the chosen server's accounts inside the existing settings sheet", () => {
  const props = setup();
  const view = render(<SettingsSheet {...props} />);
  expect(view.getByText("App lock")).toBeTruthy();
  expect(view.getByText("Buddy avatar")).toBeTruthy();
  expect(view.getByText("Buddy status")).toBeTruthy();
  expect(view.queryByText("Personal account")).toBeNull();
  expect(view.queryByText("Work account")).toBeNull();
  expect(view.queryByText("Performance diagnostics")).toBeNull();

  fireEvent.press(view.getByLabelText("Settings for Buddy"));
  expect(view.getByText("Personal account")).toBeTruthy();
  expect(view.queryByText("Work account")).toBeNull();
  expect(view.queryByText("App lock")).toBeNull();
  expect(view.getAllByTestId("native-sheet")).toHaveLength(1);
  expect(props.onClose).not.toHaveBeenCalled();

  fireEvent.press(view.getByLabelText("Back to settings"));
  fireEvent.press(view.getByLabelText("Settings for Work"));
  expect(view.getByText("Work account")).toBeTruthy();
  expect(view.queryByText("Personal account")).toBeNull();
});

it("keeps advanced controls off the overview and offers a return path", () => {
  const view = render(<SettingsSheet {...setup()} />);
  fireEvent.press(view.getByLabelText("Advanced"));
  expect(view.getByText("Performance diagnostics")).toBeTruthy();
  expect(view.queryByLabelText("Settings for Buddy")).toBeNull();
  fireEvent.press(view.getByLabelText("Back to settings"));
  expect(view.getByLabelText("Settings for Buddy")).toBeTruthy();
  expect(view.queryByText("Performance diagnostics")).toBeNull();
});

it("reads fresh server content and returns to the overview when that server is removed", () => {
  const props = setup();
  const view = render(<SettingsSheet {...props} />);
  fireEvent.press(view.getByLabelText("Settings for Buddy"));
  view.rerender(<SettingsSheet {...props} servers={[server("buddy", "Buddy renamed", "New active account")]} />);
  expect(view.getByText("Buddy renamed")).toBeTruthy();
  expect(view.getByText("New active account")).toBeTruthy();
  expect(view.queryByText("Personal account")).toBeNull();

  view.rerender(<SettingsSheet {...props} servers={[]} />);
  expect(view.getByText("No saved servers")).toBeTruthy();
  expect(view.getByLabelText("Add server")).toBeTruthy();
  expect(view.queryByText("New active account")).toBeNull();
  expect(view.queryByLabelText("Back to settings")).toBeNull();
});

it("delegates adding a server and dismissing the sheet to their existing owners", () => {
  const props = setup();
  const view = render(<SettingsSheet {...props} />);
  fireEvent.press(view.getByLabelText("Add server"));
  expect(props.onAddServer).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByLabelText("Close settings"));
  expect(props.onClose).toHaveBeenCalledTimes(1);
});
