import { render } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { ComposeNamedIcon } from "../src/presentation/icons/ComposeNamedIcon";

// WHY: Expo's Compose host and asynchronous Android painter cannot execute in
// Node. Keep the real icon adapter/modifiers and simulate an unresolved painter.
jest.mock("@expo/ui/jetpack-compose", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    Box: (props: {
      children?: ReactNode;
      modifiers: { $type: string; width?: number; height?: number }[];
    }) => {
      const dimensions = props.modifiers.find((modifier) => modifier.$type === "size");
      return (
        <View
          testID="native-icon-slot"
          style={{ width: dimensions?.width, height: dimensions?.height }}
        >
          {props.children}
        </View>
      );
    },
    Icon: () => null,
  };
});

it("reserves exact icon geometry before the native painter loads and across recycled names", () => {
  const view = render(<ComposeNamedIcon name="folder-outline" size={24} color="#ffffff" />);
  expect(view.getByTestId("native-icon-slot")).toHaveStyle({ width: 24, height: 24 });
  view.rerender(<ComposeNamedIcon name="checkmark" size={18} color="#888888" />);
  expect(view.getByTestId("native-icon-slot")).toHaveStyle({ width: 18, height: 18 });
});
