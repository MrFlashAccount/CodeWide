import { fireEvent, render } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { Linking } from "react-native";

import { SettingsVersion } from "../src/features/settings/SettingsVersion";

it("keeps version copyable without a selectable Android focus anchor", () => {
  const copy = jest.spyOn(Clipboard, "setStringAsync");
  const result = render(<SettingsVersion update={null} version="0.2.122" />);
  const version = result.getByTestId("settings-version");
  expect(version.props.selectable).toBe(false);
  fireEvent(version, "longPress");
  expect(copy).toHaveBeenLastCalledWith("Version 0.2.122");
  expect(result.queryByTestId("settings-version-update")).toBeNull();
  result.rerender(<SettingsVersion update={null} version="0.2.123" />);
  fireEvent(result.getByTestId("settings-version"), "accessibilityAction", {
    nativeEvent: { actionName: "copy" },
  });
  expect(copy).toHaveBeenLastCalledWith("Version 0.2.123");
  copy.mockRestore();
});

it("offers a newer Android release through GitHub", () => {
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  const result = render(
    <SettingsVersion
      update={{
        latestVersion: "0.5.0",
        releaseUrl: "https://github.com/MrFlashAccount/CodeWide/releases/latest",
      }}
      version="0.2.231"
    />,
  );
  expect(result.getByText("Update to 0.5.0")).toBeTruthy();
  fireEvent.press(result.getByTestId("settings-version-update"));
  expect(open).toHaveBeenCalledWith("https://github.com/MrFlashAccount/CodeWide/releases/latest");
  open.mockRestore();
});
