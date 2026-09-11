import { fireEvent, render } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { AttachmentListRow } from "../src/ui/AttachmentListRow.android";
import { listRowHeight } from "../src/ui/AppListRow.types";

// WHY: Node cannot instantiate Compose view managers. Only the external platform
// is replaced; the real cell, assets and clickable modifier dispatch are exercised.
jest.mock("@expo/ui/jetpack-compose", () => {
  const Native = jest.requireActual<typeof import("react-native")>("react-native");
  interface MockContainerProps {
    children?: ReactNode;
  }
  interface MockItemProps extends MockContainerProps {
    modifiers: { $type: string; height?: number; eventListener?: () => void }[];
  }
  const Slot = (props: MockContainerProps) => <Native.View>{props.children}</Native.View>;
  const Host = (props: MockContainerProps) => <Native.View {...props} testID="compose-host" />;
  const Item = (props: MockItemProps) => (
    <Native.Pressable
      testID="compose-item"
      style={{ height: props.modifiers.find((modifier) => modifier.$type === "height")?.height }}
      onPress={() =>
        props.modifiers.find((modifier) => modifier.$type === "clickable")?.eventListener?.()
      }
    >
      {props.children}
    </Native.Pressable>
  );
  const Icon = (props: { source: unknown }) => (
    <Native.View testID="compose-icon" dataSet={{ source: JSON.stringify(props.source) }} />
  );
  return {
    Host,
    Box: Slot,
    Text: Native.Text,
    Icon,
    ListItem: Object.assign(Item, {
      LeadingContent: Slot,
      HeadlineContent: Slot,
      SupportingContent: Slot,
      TrailingContent: Slot,
    }),
  };
});

it("keeps fixed cell geometry, native icons and a labelled action", () => {
  const onPress = jest.fn();
  const view = render(
    <AttachmentListRow
      title="photo.png"
      description="You · image"
      accessibilityLabel="Open attachment photo.png"
      leading="image"
      trailing="open"
      position="only"
      onPress={onPress}
    />,
  );
  expect(view.getByRole("button", { name: "Open attachment photo.png" })).toHaveStyle({
    height: listRowHeight.double,
  });
  expect(view.getByTestId("compose-host")).toHaveStyle({ height: listRowHeight.double });
  expect(view.getByTestId("compose-host").props.matchContents).toBe(false);
  expect(view.getByTestId("compose-item")).toHaveStyle({ height: listRowHeight.double });
  expect(view.getByText("photo.png").props.maxLines).toBe(1);
  expect(view.getByText("You · image").props.maxLines).toBe(1);
  expect(view.getAllByTestId("compose-icon")).toHaveLength(2);
  fireEvent.press(view.getByText("photo.png"));
  fireEvent.press(view.getAllByTestId("compose-icon")[0]);
  expect(onPress).toHaveBeenCalledTimes(2);
});

it("rebinds the action and all display data when LegendList recycles a cell", () => {
  const first = jest.fn();
  const second = jest.fn();
  const view = render(
    <AttachmentListRow
      title="first.png"
      description="You · image"
      accessibilityLabel="First"
      leading="image"
      trailing="open"
      position="first"
      onPress={first}
    />,
  );
  const firstIcon = view.getAllByTestId("compose-icon")[0]?.props.dataSet.source;
  fireEvent.press(view.getByTestId("compose-item"));
  view.rerender(
    <AttachmentListRow
      title="second.mp3"
      description="Codex · audio"
      accessibilityLabel="Second"
      leading="audio"
      position="last"
      onPress={second}
    />,
  );
  expect(view.queryByText("first.png")).toBeNull();
  expect(view.queryByText("You · image")).toBeNull();
  expect(view.getByText("Codex · audio")).toBeVisible();
  expect(view.getAllByTestId("compose-icon")).toHaveLength(1);
  expect(view.getByTestId("compose-icon").props.dataSet.source).not.toEqual(firstIcon);
  fireEvent.press(view.getByTestId("compose-item"));
  fireEvent(view.getByRole("button", { name: "Second" }), "accessibilityTap");
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(2);
});
