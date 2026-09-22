import { fireEvent, render } from "@testing-library/react-native";
import { useState, type ReactNode } from "react";
import { I18nManager, Pressable, Text } from "react-native";

import { SettingsSheet } from "../src/features/settings/SettingsSheet";
import { useSheetBackHandler } from "../src/ui/sheetNavigation";

// Preserve the value shared with an outgoing page after its React key changes.
jest.mock("react-native-reanimated", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const mock = jest.requireActual("./mocks/Reanimated");
  return {
    __esModule: true,
    ...mock,
    useSharedValue: (initial: unknown) => React.useState(() => mock.useSharedValue(initial))[0],
  };
});
jest.mock("../src/rendering/reduced-motion-store", () => ({
  useReducedMotionPreference: () => false,
}));

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
      onBackPress,
      onDismissRequest,
    }: {
      readonly children?: ReactNode;
      readonly onBackPress?: () => void;
      readonly onDismissRequest: () => void;
    },
    ref,
  ) {
    const [visible, setVisible] = React.useState(true);
    const dismiss = () => {
      setVisible(false);
      onDismissRequest();
    };
    React.useImperativeHandle(
      ref,
      () => ({
        hide: async () => {
          setVisible(false);
        },
      }),
      [],
    );
    if (!visible) return null;
    return (
      <View testID="native-sheet">
        {children}
        <NativePressable accessibilityLabel="Dismiss native settings" onPress={dismiss} />
        <NativePressable accessibilityLabel="Android Back" onPress={onBackPress ?? dismiss} />
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

function NestedAdvancedPage() {
  const [detail, setDetail] = useState(false);
  useSheetBackHandler(detail, () => {
    setDetail(false);
  });
  return detail ? (
    <Text>Nested settings page</Text>
  ) : (
    <Pressable
      accessibilityLabel="Open nested settings"
      onPress={() => {
        setDetail(true);
      }}
    />
  );
}

it("returns through the deepest registered page before the settings overview", () => {
  const props = setup();
  const view = render(<SettingsSheet {...props} advanced={<NestedAdvancedPage />} />);
  fireEvent.press(view.getByLabelText("Advanced"));
  fireEvent.press(view.getByLabelText("Open nested settings"));
  expect(view.getByText("Nested settings page")).toBeTruthy();
  fireEvent.press(view.getByLabelText("Android Back"));
  expect(view.getByLabelText("Open nested settings")).toBeTruthy();
  expect(view.getByTestId("native-sheet")).toBeTruthy();
  fireEvent.press(view.getByLabelText("Android Back"));
  expect(view.getByLabelText("Advanced")).toBeTruthy();
  expect(props.onClose).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText("Android Back"));
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

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

it.each(["Advanced", "Security", "Voice Assistant", "Settings for Buddy"])(
  "handles Android Back from %s before the native sheet hides",
  (label) => {
    const props = setup();
    const view = render(<SettingsSheet {...props} />);

    fireEvent.press(view.getByLabelText(label));
    expect(view.getByLabelText("Back to settings")).toBeTruthy();

    fireEvent.press(view.getByLabelText("Android Back"));
    expect(view.getByLabelText("Advanced")).toBeTruthy();
    expect(view.queryByText("Advanced controls")).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(view.getByTestId("native-sheet")).toBeTruthy();

    fireEvent.press(view.getByLabelText("Android Back"));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(view.queryByTestId("native-sheet")).toBeNull();
  },
);

it("closes the whole sheet after an actual native swipe or scrim dismissal", () => {
  const props = setup();
  const view = render(<SettingsSheet {...props} />);
  fireEvent.press(view.getByLabelText("Advanced"));
  fireEvent.press(view.getByLabelText("Dismiss native settings"));
  expect(props.onClose).toHaveBeenCalledTimes(1);
  expect(view.queryByTestId("native-sheet")).toBeNull();
});

it("opens Voice Assistant directly and consumes a later deep-link request after Back", () => {
  const props = setup();
  const view = render(<SettingsSheet {...props} entryPage="voiceAssistant" entryRequest="first" />);
  expect(view.getByText("Voice Assistant choices")).toBeTruthy();
  expect(view.queryByText("Servers")).toBeNull();
  fireEvent.press(view.getByRole("button", { name: "Back to settings" }));
  expect(view.getByText("Servers")).toBeTruthy();
  view.rerender(<SettingsSheet {...props} entryPage="voiceAssistant" entryRequest="second" />);
  expect(view.getByText("Voice Assistant choices")).toBeTruthy();
  expect(view.queryByText("Servers")).toBeNull();
  expect(props.onClose).not.toHaveBeenCalled();
});

const originalRTL = I18nManager.isRTL;
afterEach(() => {
  I18nManager.isRTL = originalRTL;
});

it.each([
  { rtl: false, back: "Back to settings", childEdge: 40, parentEdge: -20 },
  { rtl: false, back: "Android Back", childEdge: 40, parentEdge: -20 },
  { rtl: true, back: "Back to settings", childEdge: -40, parentEdge: 20 },
  { rtl: true, back: "Android Back", childEdge: -40, parentEdge: 20 },
])(
  "uses pop for $back (RTL=$rtl) while keeping the native sheet open",
  ({ rtl, back, childEdge, parentEdge }) => {
    I18nManager.isRTL = rtl;
    const props = setup();
    const view = render(<SettingsSheet {...props} />);
    for (let visit = 0; visit < 3; visit += 1) {
      const parentExit = view.getByTestId("sheet-page:overview").props.exiting;
      fireEvent.press(view.getByLabelText("Advanced"));
      const childExit = view.getByTestId("sheet-page:advanced").props.exiting;
      const departingParent = parentExit({ windowWidth: 1000 });
      expect(departingParent.initialValues.transform).toEqual([{ translateX: 0 }]);
      expect(departingParent.animations.transform).toEqual([{ translateX: parentEdge }]);
      const push = view.getByTestId("sheet-page:advanced").props.entering({ windowWidth: 1000 });
      expect(push.initialValues.transform).toEqual([{ translateX: childEdge }]);
      expect(push.animations.transform).toEqual([{ translateX: 0 }]);
      fireEvent.press(view.getByLabelText(back));
      const departingChild = childExit({ windowWidth: 1000 });
      expect(departingChild.initialValues.transform).toEqual([{ translateX: 0 }]);
      expect(departingChild.animations.transform).toEqual([{ translateX: childEdge }]);
      const pop = view.getByTestId("sheet-page:overview").props.entering({ windowWidth: 1000 });
      expect(pop.initialValues.transform).toEqual([{ translateX: parentEdge }]);
      expect(pop.animations.transform).toEqual([{ translateX: 0 }]);
      expect(view.getByTestId("native-sheet")).toBeTruthy();
      expect(props.onClose).not.toHaveBeenCalled();
    }
  },
);
