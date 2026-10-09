import { act, render } from "@testing-library/react-native";
import { View } from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  State,
} from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { useAppNoticeMotion } from "../src/ui/appNoticeMotion";

function Notice({
  onDismiss,
  onInteracting,
}: {
  onDismiss: () => void;
  onInteracting: (value: boolean) => void;
}): React.JSX.Element {
  const motion = useAppNoticeMotion({
    expanded: false,
    height: 56,
    index: 0,
    offset: 0,
    onInteractingChange: onInteracting,
    onSwipeDismiss: onDismiss,
    visible: true,
  });
  return (
    <GestureHandlerRootView>
      <GestureDetector gesture={motion.pan.withTestId("notice-pan")}>
        <View />
      </GestureDetector>
    </GestureHandlerRootView>
  );
}
function swipe(x: number, y: number, cancelled = false): void {
  act(() =>
    fireGestureHandler<ReturnType<typeof Gesture.Pan>>(getByGestureTestId("notice-pan"), [
      { state: State.BEGAN, translationX: 0, translationY: 0, velocityX: 0, velocityY: 0 },
      { state: State.ACTIVE, translationX: 0, translationY: 0, velocityX: 0, velocityY: 0 },
      { state: State.ACTIVE, translationX: x, translationY: y, velocityX: 0, velocityY: 0 },
      {
        state: cancelled ? State.CANCELLED : State.END,
        translationX: x,
        translationY: y,
        velocityX: 0,
        velocityY: 0,
      },
    ]),
  );
}
it.each([
  [70, 0, true],
  [-70, 0, true],
  [0, -70, true],
  [0, 70, false],
  [10, 0, false],
])("dismisses only a completed exit gesture (%s, %s)", (x, y, dismisses) => {
  const onDismiss = jest.fn();
  const onInteracting = jest.fn();
  const view = render(<Notice onDismiss={onDismiss} onInteracting={onInteracting} />);
  swipe(x, y);
  expect(onDismiss).toHaveBeenCalledTimes(dismisses ? 1 : 0);
  expect(onInteracting.mock.calls).toEqual([[true], [false]]);
  view.unmount();
});
it("releases interaction without dismissing a cancelled gesture", () => {
  const onDismiss = jest.fn();
  const onInteracting = jest.fn();
  const view = render(<Notice onDismiss={onDismiss} onInteracting={onInteracting} />);
  swipe(70, 0, true);
  expect(onDismiss).not.toHaveBeenCalled();
  expect(onInteracting.mock.calls).toEqual([[true], [false]]);
  view.unmount();
});
it("uses the latest callbacks from a retained gesture", () => {
  const oldDismiss = jest.fn();
  const oldInteracting = jest.fn();
  const onDismiss = jest.fn();
  const onInteracting = jest.fn();
  const view = render(<Notice onDismiss={oldDismiss} onInteracting={oldInteracting} />);
  view.rerender(<Notice onDismiss={onDismiss} onInteracting={onInteracting} />);
  swipe(70, 0);
  expect(oldDismiss).not.toHaveBeenCalled();
  expect(oldInteracting).not.toHaveBeenCalled();
  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(onInteracting.mock.calls).toEqual([[true], [false]]);
  view.unmount();
});
