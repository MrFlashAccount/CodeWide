import { render } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Text } from "react-native";
import { Column, Host, RNHostView } from "@expo/ui/jetpack-compose";
import { ContentReviewKeyboardDock } from "../src/rendering/ContentReviewKeyboardDock.android";
import { OverlaySurfaceProvider } from "../src/ui/OverlaySurfaceContext";

interface NativeHostProps { children?: ReactNode }

// WHY: Compose requires Android. Exercise the real dock and surface context;
// replace only native views. Native IME animation is not simulated by this test.
jest.mock("@expo/ui/jetpack-compose", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    Host: (props: NativeHostProps) => <View>{props.children}</View>,
    Column: (props: NativeHostProps) => <View>{props.children}</View>,
    RNHostView: (props: NativeHostProps) => <View>{props.children}</View>,
  };
});

it("uses the dialog's IME padding outside the React Native size-reporting host", () => {
  const view = render(
    <OverlaySurfaceProvider surface="fullscreen-modal">
      <ContentReviewKeyboardDock><Text>Pin comment</Text></ContentReviewKeyboardDock>
    </OverlaySurfaceProvider>,
  );
  expect(view.queryByTestId("keyboard-sticky-view")).toBeNull();
  const host = view.UNSAFE_getByType(Host);
  expect(host.props.ignoreSafeAreaKeyboardInsets).toBe(true);
  const paddingOwner = view.UNSAFE_getByType(Column);
  // The Expo modifier name is the public native bridge contract. Insets must
  // shrink the RNHost's constraints, not just pad its already reported size.
  expect(paddingOwner.props.modifiers).toEqual(expect.arrayContaining([expect.objectContaining({ $type: "imePadding" })]));
  const nativeHost = paddingOwner.findByType(RNHostView);
  expect(nativeHost.props.matchContents).toBe(false);
  expect(nativeHost.props.modifiers).toBeUndefined();
  expect(view.getByText("Pin comment")).toBeTruthy();
});

it("preserves root-window keyboard following for inline chat comments", () => {
  const view = render(<ContentReviewKeyboardDock><Text>Inline comment</Text></ContentReviewKeyboardDock>);
  expect(view.getByTestId("keyboard-sticky-view")).toBeTruthy();
  expect(view.UNSAFE_queryAllByType(Host)).toHaveLength(0);
  expect(view.getByText("Inline comment")).toBeTruthy();
});
