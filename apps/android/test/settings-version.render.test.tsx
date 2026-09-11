import { fireEvent, render } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";

import { SettingsVersion } from "../src/ui/SettingsVersion";

it("keeps version copyable without a selectable Android focus anchor", () => {
  const copy = jest.spyOn(Clipboard, "setStringAsync");
  const result = render(<SettingsVersion version="0.2.122" />);
  const version = result.getByTestId("settings-version");
  expect(version.props.selectable).toBe(false);
  fireEvent(version, "longPress");
  expect(copy).toHaveBeenLastCalledWith("Version 0.2.122");
  result.rerender(<SettingsVersion version="0.2.123" />);
  fireEvent(result.getByTestId("settings-version"), "accessibilityAction", { nativeEvent: { actionName: "copy" } });
  expect(copy).toHaveBeenLastCalledWith("Version 0.2.123");
  copy.mockRestore();
});
