import { act, fireEvent, render } from "@testing-library/react-native";
import { View } from "react-native";
import { Gesture, GestureDetector, State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";

import { ThreadListSearchPullProvider } from "../src/features/threadList/ThreadListFeature";
import { ThreadListSearchRow } from "../src/features/threadList/ThreadListSearchRow";
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
  act(() => current.phase$.set("armed"));
  expect(view.getByLabelText("Search threads and messages").props.accessibilityHint).toBe(
    "Opening search",
  );
  fireEvent.press(button);
  expect(onOpenSearch).toHaveBeenCalledTimes(1);
});

it("opens at the pull threshold before release and only when the list is at the top", () => {
  const onOpenSearch = jest.fn();
  function PullProbe(): React.JSX.Element {
    const pull = useThreadListPullGesture(onOpenSearch);
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
  act(() => {
    fireEvent.scroll(view.getByTestId("pull-viewport"), {
      nativeEvent: { contentOffset: { y: 0 } },
    });
    fireGestureHandler<ReturnType<typeof Gesture.Pan>>(gesture, [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: 79 },
      { state: State.ACTIVE, translationY: 81 },
      { state: State.ACTIVE, translationY: 100 },
    ]);
  });
  expect(onOpenSearch).toHaveBeenCalledTimes(1);
});
