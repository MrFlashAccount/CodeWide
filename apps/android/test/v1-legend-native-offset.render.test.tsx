import type { LegendListProps, LegendListRef } from "@legendapp/list/react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import { createRef } from "react";
import { ScrollView, type ScrollViewProps, View } from "react-native";
import { TimelineResponseStart } from "../src/features/conversation/timeline/timelineResponseStart";

// Exercise the installed native entry, not the presentation tests' LegendList double.
const { LegendList } = jest.requireActual<typeof import("@legendapp/list/react-native")>(
  "../node_modules/@legendapp/list/react-native.js",
);
const rows = Array.from({ length: 40 }, (_, id) => ({ id }));

function NativeScroll(props: ScrollViewProps) {
  return <ScrollView {...props} testID="native-offset-scroll" />;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it("seeds the native unread last row at its top rather than its bottom", () => {
  const lastIndex = rows.length - 1;
  const topInset = 62;
  const request = new TimelineResponseStart("initialUnread", "turn");
  const height = (item: (typeof rows)[number]) => (item.id === lastIndex ? 1_200 : 100);
  const view = render(
    <LegendList
      contentContainerStyle={{ paddingTop: topInset }}
      data={rows}
      estimatedListSize={{ height: 360, width: 420 }}
      getFixedItemSize={height}
      initialScrollIndex={request.initialPosition(
        { index: lastIndex, key: String(lastIndex) },
        topInset,
      )}
      keyExtractor={(item) => String(item.id)}
      recycleItems={false}
      renderItem={({ item }) => <View style={{ height: height(item) }} />}
      renderScrollComponent={NativeScroll}
    />,
  );
  const responseTop = lastIndex * 100 + topInset;
  const nativeOffset = view.getByTestId("native-offset-scroll").props.contentOffset.y;
  // Native contentOffset is the mount seed. A numeric last index would show the answer's end.
  expect(responseTop - nativeOffset).toBe(topInset);
  view.unmount();
});

it.each(["tail", "unread"] as const)(
  "does not remove native contentOffset after releasing %s bootstrap",
  async (mode) => {
    const ref = createRef<LegendListRef>();
    function list(positioned: boolean) {
      const initial: Partial<LegendListProps<(typeof rows)[number]>> = positioned
        ? {}
        : mode === "tail"
          ? { initialScrollAtEnd: true }
          : { initialScrollIndex: 30 };
      return (
        <LegendList
          {...initial}
          data={rows}
          estimatedItemSize={100}
          estimatedListSize={{ height: 360, width: 420 }}
          keyExtractor={(item) => String(item.id)}
          recycleItems={false}
          ref={ref}
          renderItem={() => <View style={{ height: 100 }} />}
          renderScrollComponent={NativeScroll}
        />
      );
    }
    const view = render(list(false));
    fireEvent(view.getByTestId("native-offset-scroll"), "layout", {
      nativeEvent: { layout: { height: 360, width: 420, x: 0, y: 0 } },
    });
    const initialOffset = view.getByTestId("native-offset-scroll").props.contentOffset;
    expect(initialOffset.y).toBeGreaterThan(0);
    act(() => {
      void ref.current?.scrollToEnd({ animated: false });
    });
    view.rerender(list(true));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });

    // This is a native protocol contract: removing this prop sends null, and Android
    // ReactScrollView.setContentOffset(null) explicitly executes scrollTo(0, 0).
    expect(view.getByTestId("native-offset-scroll").props.contentOffset).toEqual(initialOffset);
    view.unmount();
  },
);
