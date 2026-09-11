import { fireEvent, render } from "@testing-library/react-native";
import { createRef } from "react";
import { ScrollView, Text } from "react-native";

import { AppSheetScrollView } from "../src/ui/AppSheet.android";

// WHY: Jest cannot initialize the Compose window registry. This test mounts
// the actual React Native scroll host, not the unused native sheet window.
jest.mock("@expo/ui/jetpack-compose", () => ({}));
// WHY: The native portal registry is not available in the Node renderer.
jest.mock("heroui-native/portal", () => ({ PortalHost: () => null }));

it("preserves the virtual list ref and scroll events in one sheet-integrated scroll host", () => {
  const ref = createRef<ScrollView>();
  const onScroll = jest.fn();
  const onContentSizeChange = jest.fn();
  const view = render(<AppSheetScrollView ref={ref} testID="attachments-scroll"
    onScroll={onScroll} onContentSizeChange={onContentSizeChange}>
    <Text>Attachment</Text>
  </AppSheetScrollView>);
  expect(view.UNSAFE_getAllByType(ScrollView)).toHaveLength(1);
  expect(ref.current?.scrollTo).toEqual(expect.any(Function));
  const scroll = view.getByTestId("attachments-scroll");
  expect(scroll.props.nestedScrollEnabled).toBe(true);
  expect(scroll.props.fadingEdgeLength).toBeUndefined();
  const event = { nativeEvent: { contentOffset: { x: 0, y: 72 } } };
  fireEvent.scroll(scroll, event);
  expect(onScroll).toHaveBeenCalledWith(event);
  fireEvent(scroll, "contentSizeChange", 320, 720);
  expect(onContentSizeChange).toHaveBeenCalledWith(320, 720);
});

it("preserves an explicit nested-scroll opt-out for other sheet consumers", () => {
  const view = render(<AppSheetScrollView testID="scroll" nestedScrollEnabled={false} />);
  expect(view.getByTestId("scroll").props.nestedScrollEnabled).toBe(false);
});
