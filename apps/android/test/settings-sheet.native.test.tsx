import { fireEvent, render } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Text } from "react-native";

import { SettingsSheet } from "../src/features/settings/SettingsSheet";

// WHY: Node cannot host the external Compose window. Exercise the real settings navigation,
// AppSheet and list rows while replacing only the unavailable platform surface.
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
    {
      children,
      onDismissRequest,
    }: { readonly children?: ReactNode; readonly onDismissRequest: () => void },
    ref,
  ) {
    React.useImperativeHandle(ref, () => ({ hide: async () => undefined }), []);
    return (
      <View testID="native-sheet">
        {children}
        <NativePressable accessibilityLabel="Dismiss native settings" onPress={onDismissRequest} />
      </View>
    );
  });
  return {
    Box: Slot,
    CircularProgressIndicator: Slot,
    Host,
    Icon: Slot,
    ListItem,
    ModalBottomSheet,
    RNHostView: Host,
    Row: Slot,
    Text: NativeText,
  };
});

function server(id: string, title: string, account: string) {
  return {
    id,
    title,
    description: "Connected",
    leading: <Text>{`${title} avatar`}</Text>,
    statusIcon: <Text>{`${title} status`}</Text>,
    content: <Text>{account}</Text>,
  };
}

function setup() {
  return {
    servers: [server("buddy", "Buddy", "Personal account"), server("work", "Work", "Work account")],
    security: <Text>Biometric Lock setting</Text>,
    advanced: <Text>Advanced controls</Text>,
    version: <Text>Version test</Text>,
    onAddServer: jest.fn(),
    onClose: jest.fn(),
    visible: true,
    voiceAssistant: {
      content: <Text>Voice Assistant choices</Text>,
      description: "Cove · Default personality",
    },
  };
}

it("opens only the chosen server's accounts inside the existing settings sheet", () => {
  const props = setup();
  const view = render(<SettingsSheet {...props} />);
  expect(view.getByLabelText("Security")).toBeTruthy();
  expect(view.queryByText("Biometric Lock setting")).toBeNull();
  expect(view.getByText("Buddy avatar")).toBeTruthy();
  expect(view.getByText("Buddy status")).toBeTruthy();
  expect(view.queryByText("Personal account")).toBeNull();
  expect(view.queryByText("Work account")).toBeNull();
  expect(view.queryByText("Advanced controls")).toBeNull();

  fireEvent.press(view.getByLabelText("Settings for Buddy"));
  expect(view.getByText("Personal account")).toBeTruthy();
  expect(view.queryByText("Work account")).toBeNull();
  expect(view.queryByLabelText("Security")).toBeNull();
  expect(view.getAllByTestId("native-sheet")).toHaveLength(1);
  expect(props.onClose).not.toHaveBeenCalled();

  fireEvent.press(view.getByLabelText("Back to settings"));
  fireEvent.press(view.getByLabelText("Settings for Work"));
  expect(view.getByText("Work account")).toBeTruthy();
  expect(view.queryByText("Personal account")).toBeNull();
});

it("opens Security as its own page and keeps only Servers as an overview section", () => {
  const view = render(<SettingsSheet {...setup()} />);
  expect(view.getByRole("header", { name: "Servers" })).toBeTruthy();
  expect(view.queryByRole("header", { name: "Security" })).toBeNull();
  expect(view.queryByRole("header", { name: "Voice Assistant" })).toBeNull();
  expect(view.getByTestId("settings-navigation-list")).toBeTruthy();

  fireEvent.press(view.getByLabelText("Security"));
  expect(view.getByRole("header", { name: "Security" })).toBeTruthy();
  expect(view.getByText("Biometric Lock setting")).toBeTruthy();
  expect(view.queryByLabelText("Voice Assistant")).toBeNull();

  fireEvent.press(view.getByLabelText("Back to settings"));
  expect(view.getByLabelText("Voice Assistant")).toBeTruthy();
  expect(view.getByLabelText("Advanced")).toBeTruthy();
});

it("keeps advanced controls off the overview and offers a return path", () => {
  const view = render(<SettingsSheet {...setup()} />);
  fireEvent.press(view.getByLabelText("Advanced"));
  expect(view.getByText("Advanced controls")).toBeTruthy();
  expect(view.queryByLabelText("Settings for Buddy")).toBeNull();
  fireEvent.press(view.getByLabelText("Back to settings"));
  expect(view.getByLabelText("Settings for Buddy")).toBeTruthy();
  expect(view.queryByText("Advanced controls")).toBeNull();
});

it("opens Voice Assistant settings from the unified settings list", () => {
  const view = render(<SettingsSheet {...setup()} />);
  expect(view.getByText("Cove · Default personality")).toBeTruthy();
  fireEvent.press(view.getByLabelText("Voice Assistant"));
  expect(view.getByText("Voice Assistant choices")).toBeTruthy();
  expect(view.getByRole("header", { name: "Voice Assistant" })).toBeTruthy();
  expect(view.queryByLabelText("Settings for Buddy")).toBeNull();
  fireEvent.press(view.getByLabelText("Back to settings"));
  expect(view.getByLabelText("Settings for Buddy")).toBeTruthy();
});

it("reads fresh server content and returns to the overview when that server is removed", () => {
  const props = setup();
  const view = render(<SettingsSheet {...props} />);
  fireEvent.press(view.getByLabelText("Settings for Buddy"));
  view.rerender(
    <SettingsSheet {...props} servers={[server("buddy", "Buddy renamed", "New active account")]} />,
  );
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
  fireEvent.press(view.getByLabelText("Dismiss native settings"));
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

it("gives native Back to the visible settings page before closing the sheet", () => {
  const props = setup();
  const view = render(<SettingsSheet {...props} />);

  fireEvent.press(view.getByLabelText("Advanced"));
  expect(view.getByText("Advanced controls")).toBeTruthy();

  fireEvent.press(view.getByLabelText("Dismiss native settings"));
  expect(view.getByLabelText("Advanced")).toBeTruthy();
  expect(view.queryByText("Advanced controls")).toBeNull();
  expect(props.onClose).not.toHaveBeenCalled();

  fireEvent.press(view.getByLabelText("Dismiss native settings"));
  expect(props.onClose).toHaveBeenCalledTimes(1);
});
