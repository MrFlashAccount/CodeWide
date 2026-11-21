import { fireEvent, render } from "@testing-library/react-native";
import { View } from "react-native";
import type { ReactElement } from "react";

const { LegendList } = jest.requireActual<typeof import("@legendapp/list/react-native")>(
  "@legendapp/list/react-native",
);

/** Mounts content in a real recycled cell, with the viewport size supplied by the fixture. */
export function renderLegendListCell(content: ReactElement) {
  const view = render(
    <LegendList
      data={["row"]}
      getFixedItemSize={() => 80}
      estimatedListSize={{ height: 640, width: 360 }}
      recycleItems
      renderItem={() => <View testID="fixture-cell">{content}</View>}
      testID="fixture-viewport"
    />,
  );
  fireEvent(view.getByTestId("fixture-viewport"), "layout", {
    nativeEvent: { layout: { x: 0, y: 0, height: 640, width: 360 } },
  });
  fireEvent(view.getByTestId("fixture-cell"), "layout", {
    nativeEvent: { layout: { x: 0, y: 0, height: 80, width: 360 } },
  });
  return view;
}
