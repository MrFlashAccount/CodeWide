import { fireEvent, type RenderResult } from "@testing-library/react-native";

/**
 * Reports each open anchored menu body's laid-out content height, as React
 * Native layout does on a device: the menu opens once it knows that height.
 */
export function layOutContentMenus(view: RenderResult, contentHeight = 240): void {
  for (const body of view.queryAllByTestId("content-menu-body")) {
    fireEvent(body, "contentSizeChange", 320, contentHeight);
  }
}
