import { act, fireEvent, render } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector, State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";

import { ThreadListSearchPullProvider } from "../src/features/threadList/ThreadListFeature";
import { ThreadListSearchRow } from "../src/features/threadList/ThreadListSearchRow";
import { controlSize, spacing } from "../src/theme";
import {
  useThreadListSearchPullModel,
  useThreadListPullGesture,
  type ThreadListSearchPullModel,
} from "../src/features/threadList/threadListSearchPull";

it("subscribes the fixed search row to the gesture's semantic phase", () => {
  let model: ThreadListSearchPullModel | null = null;
  const onOpenSearch = jest.fn();
  function SearchRowProbe(): React.JSX.Element {
    model = useThreadListSearchPullModel();
    return <ThreadListSearchRow onOpenSearch={onOpenSearch} />;
  }
  const view = render(
    <ThreadListSearchPullProvider>
      <SearchRowProbe />
    </ThreadListSearchPullProvider>,
  );
  const button = view.getByLabelText("Search threads and messages");
  expect(button.props.accessibilityHint).toBe("Pull down to search");
  const current = model;
  if (current === null) {
    throw new Error("Expected the thread-list search pull model");
  }
  act(() => {
    current.distance.set(80);
    current.phase$.set("armed");
  });
  expect(view.getByLabelText("Search threads and messages").props.accessibilityHint).toBe(
    "Release to search",
  );
  expect(StyleSheet.flatten(view.getByTestId("thread-search-row").props.style).transform).toEqual([
    { translateY: (controlSize.regular + spacing.xs) * 0.7 },
    { scale: 1.02 },
  ]);
  fireEvent.press(button);
  expect(onOpenSearch).toHaveBeenCalledTimes(1);
});

it("arms with a soft haptic and opens only after an armed pull is released at the list top", () => {
  const onOpenSearch = jest.fn();
  const haptic = jest.spyOn(Haptics, "selectionAsync").mockImplementation(() => {
    expect(onOpenSearch).not.toHaveBeenCalled();
    return Promise.resolve();
  });
  function PullProbe(): React.JSX.Element {
    const pull = useThreadListPullGesture(onOpenSearch, 0, "all:active:global");
    return (
      <GestureDetector gesture={pull.gesture}>
        <View onScroll={pull.onScroll} testID="pull-viewport" />
      </GestureDetector>
    );
  }
  const view = render(
    <ThreadListSearchPullProvider>
      <PullProbe />
    </ThreadListSearchPullProvider>,
  );
  const gesture = getByGestureTestId("thread-list-pull-to-search");
  act(() => {
    fireEvent.scroll(view.getByTestId("pull-viewport"), {
      nativeEvent: { contentOffset: { y: 30 } },
    });
    fireGestureHandler<ReturnType<typeof Gesture.Pan>>(gesture, [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: 90 },
      { state: State.END, translationY: 90 },
    ]);
  });
  expect(onOpenSearch).not.toHaveBeenCalled();
  expect(haptic).not.toHaveBeenCalled();
  act(() => {
    fireEvent.scroll(view.getByTestId("pull-viewport"), {
      nativeEvent: { contentOffset: { y: 0 } },
    });
    fireGestureHandler<ReturnType<typeof Gesture.Pan>>(gesture, [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: 79 },
      { state: State.ACTIVE, translationY: 81 },
      { state: State.ACTIVE, translationY: 100 },
      { state: State.END, translationY: 100 },
    ]);
  });
  expect(onOpenSearch).toHaveBeenCalledTimes(1);
  expect(haptic).toHaveBeenCalledTimes(1);
  haptic.mockRestore();
});

it("disarms when the finger retreats and ignores a cancelled armed pull", () => {
  const onOpenSearch = jest.fn();
  const haptic = jest.spyOn(Haptics, "selectionAsync");
  function PullProbe(): React.JSX.Element {
    const pull = useThreadListPullGesture(onOpenSearch, 0, "all:active:global");
    return (
      <GestureDetector gesture={pull.gesture}>
        <View onScroll={pull.onScroll} />
      </GestureDetector>
    );
  }
  render(
    <ThreadListSearchPullProvider>
      <PullProbe />
    </ThreadListSearchPullProvider>,
  );
  const gesture = getByGestureTestId("thread-list-pull-to-search");
  act(() => {
    fireGestureHandler<ReturnType<typeof Gesture.Pan>>(gesture, [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: 0 },
      { state: State.ACTIVE, translationY: 90 },
      { state: State.ACTIVE, translationY: 40 },
      { state: State.END, translationY: 40 },
    ]);
  });
  expect(onOpenSearch).not.toHaveBeenCalled();
  expect(haptic).toHaveBeenCalledTimes(1);
  act(() => {
    fireGestureHandler<ReturnType<typeof Gesture.Pan>>(gesture, [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: 0 },
      { state: State.ACTIVE, translationY: 90 },
      { state: State.CANCELLED, translationY: 90 },
    ]);
  });
  expect(onOpenSearch).not.toHaveBeenCalled();
  haptic.mockRestore();
});
