import { fireEvent, render } from "@testing-library/react-native";
import type { ReactNode } from "react";
import type { ViewProps } from "react-native";
import { SkillPickerRow } from "../src/ui/SkillPickerRow.android";
import { listRowHeight } from "../src/ui/AppListRow.types";

// WHY: Node cannot mount the Compose view manager; retain the real adapter and modifier callbacks and replace only Expo's native hosts.
jest.mock("@expo/ui/jetpack-compose", () => {
  const { View, Text, Pressable } = jest.requireActual<typeof import("react-native")>("react-native");
  const Host = (props: ViewProps) => <View {...props} testID="skill-native-host" />;
  const Item = ({ children, modifiers }: { children?: ReactNode; modifiers: { $type: string; eventListener?: () => void }[] }) =>
    <Pressable accessibilityRole="button" onPress={() => modifiers.find((modifier) => modifier.$type === "clickable")?.eventListener?.()}>{children}</Pressable>;
  return { Host, Text, ListItem: Object.assign(Item, { HeadlineContent: Host, SupportingContent: Host }) };
});

it("invokes the current skill through the native modifier after a recycled row changes", () => {
  const first = jest.fn();
  const second = jest.fn();
  const view = render(<SkillPickerRow title="First skill" description="Brief purpose" onPress={first} />);
  expect(view.getAllByTestId("skill-native-host")[0]).toHaveStyle({ height: listRowHeight.double });
  expect(view.getAllByTestId("skill-native-host")[0]?.props.matchContents).toBe(false);
  expect(view.getByText("Brief purpose")).toBeVisible();
  fireEvent.press(view.getByRole("button"));
  expect(first).toHaveBeenCalledTimes(1);
  view.rerender(<SkillPickerRow title="Second skill" description="" onPress={second} />);
  expect(view.getAllByTestId("skill-native-host")[0]).toHaveStyle({ height: listRowHeight.double });
  expect(view.queryByText("Brief purpose")).toBeNull();
  fireEvent.press(view.getByRole("button"));
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
});
