import { act, render } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Dimensions, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { AppSheet } from "../src/ui/AppSheet.android";

// Node cannot measure Compose. Observe the sizing contract passed to both
// native layout trees; real wide-window clipping is checked on Android.
jest.mock("@expo/ui/jetpack-compose", () => {
  const { View: NativeView } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    Host: ({ children, style }: { children: ReactNode; style: StyleProp<ViewStyle> }) => (
      <NativeView style={style} testID="yoga-sheet-root">
        {children}
      </NativeView>
    ),
    ModalBottomSheet: ({ children, ...props }: { children: ReactNode }) => (
      <NativeView {...props} testID="material-sheet">
        {children}
      </NativeView>
    ),
    RNHostView: ({ children }: { children: ReactNode }) => <NativeView>{children}</NativeView>,
  };
});

const originalWindow = Dimensions.get("window");
afterEach(() => {
  Dimensions.set({ window: originalWindow });
});

it.each([true, false])(
  "keeps content and Material widths aligned across folding, dynamic sizing = %s",
  (enableDynamicSizing) => {
    const contentProps = { enableDynamicSizing, index: 0 };
    const sheet = (
      <AppSheet contentProps={contentProps} isOpen onOpenChange={jest.fn()}>
        <View>
          <Text>Running terminals</Text>
          <Text>No running terminals</Text>
        </View>
      </AppSheet>
    );
    Dimensions.set({ window: { width: 936, height: 844, scale: 2, fontScale: 1 } });
    const view = render(sheet);
    // 640dp is the standard Material sheet maximum, not the unfolded window.
    for (const [windowWidth, expectedWidth] of [
      [936, 640],
      [390, 390],
      [600, 600],
      [1000, 640],
    ]) {
      act(() => {
        Dimensions.set({ window: { width: windowWidth, height: 844, scale: 2, fontScale: 1 } });
      });
      view.rerender(
        <AppSheet contentProps={contentProps} isOpen onOpenChange={jest.fn()}>
          <View>
            <Text>Running terminals</Text>
            <Text>No running terminals</Text>
          </View>
        </AppSheet>,
      );
      expect(StyleSheet.flatten(view.getByTestId("yoga-sheet-root").props.style).width).toBe(
        expectedWidth,
      );
      expect(view.getByTestId("material-sheet").props.modifiers).toContainEqual({
        $type: "width",
        width: expectedWidth,
      });
      expect(view.getByText("Running terminals")).toBeVisible();
    }
  },
);
