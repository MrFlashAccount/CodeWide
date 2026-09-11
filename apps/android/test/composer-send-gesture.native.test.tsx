import { act, fireEvent, render } from "@testing-library/react-native";
import { Gesture, State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import * as Haptics from "expo-haptics";
import { SwipeDiscardAction } from "../src/ui/SwipeDiscardAction";

// Native adapters (RNGH, Reanimated, icons and haptics) use the configured Node
// substitutes; all gesture callbacks and action dispatch are the real component.
interface Point { x: number; y: number; pointers?: number }
interface Options { disabled: boolean; discard: boolean; steer: boolean }
const ENABLED: Options = { disabled: false, discard: true, steer: true };

function mount(options: Options = ENABLED) {
  const discard = jest.fn();
  const steer = jest.fn();
  const press = jest.fn();
  const longPress = jest.fn();
  const view = render(<SwipeDiscardAction
    accessibilityLabel="Send message" disabled={options.disabled}
    discardEnabled={options.discard} steerEnabled={options.steer}
    icon="arrow-up" iconColor="white" style={{ width: 48, height: 48 }}
    onDiscard={discard} onSteer={steer} onPress={press} onLongPress={longPress}
  />);
  function swipe(points: readonly Point[], cancelled = false) {
    const last = points.at(-1) ?? { x: 0, y: 0 };
    act(() => fireGestureHandler<ReturnType<typeof Gesture.Pan>>(getByGestureTestId("composer-send-pan"), [
      { state: State.BEGAN, translationX: 0, translationY: 0, numberOfPointers: 1 },
      // Android PanGestureHandler.activate resets translation before ACTIVE.
      { state: State.ACTIVE, translationX: 0, translationY: 0, numberOfPointers: 1 },
      ...points.map((point) => ({ state: State.ACTIVE, translationX: point.x, translationY: point.y, numberOfPointers: point.pointers ?? 1 })),
      { state: cancelled ? State.CANCELLED : State.END, translationX: last.x, translationY: last.y, numberOfPointers: 1 },
    ]));
  }
  return { view, discard, steer, press, longPress, swipe };
}

it("discards on a left swipe after Android's zero-translation activation", () => {
  const f = mount();
  f.swipe([{ x: -12, y: 0 }, { x: -70, y: 0 }]);
  expect(f.discard).toHaveBeenCalledTimes(1);
  expect(f.steer).not.toHaveBeenCalled();
  expect(f.press).not.toHaveBeenCalled();
});

it("steers on an upward swipe after zero-translation activation", () => {
  const f = mount();
  f.swipe([{ x: 0, y: -12 }, { x: 0, y: -70 }]);
  expect(f.steer).toHaveBeenCalledTimes(1);
  expect(f.discard).not.toHaveBeenCalled();
});

it("keeps direction locked when the drag changes axis", () => {
  const f = mount();
  f.swipe([{ x: -12, y: 0 }, { x: -70, y: -100 }]);
  expect(f.discard).toHaveBeenCalledTimes(1);
  expect(f.steer).not.toHaveBeenCalled();
});

it.each([
  [{ x: -20, y: 0 }],
  [{ x: -70, y: 0 }, { x: -10, y: 0 }],
  [{ x: 15, y: 0 }, { x: -80, y: 0 }],
  [{ x: 0, y: 15 }, { x: 0, y: -80 }],
  [{ x: -20, y: 0 }, { x: -70, y: 0, pointers: 2 }, { x: -90, y: 0 }],
])("does not dispatch a short, retracted, rejected-direction or multitouch gesture (%#)", (...points: Point[]) => {
  const f = mount();
  f.swipe(points);
  expect(f.discard).not.toHaveBeenCalled();
  expect(f.steer).not.toHaveBeenCalled();
});

it("does not dispatch on cancellation", () => {
  const f = mount();
  f.swipe([{ x: -70, y: 0 }], true);
  expect(f.discard).not.toHaveBeenCalled();
});

it("allows discard while sending is disabled, but rejects steer", () => {
  const f = mount({ disabled: true, discard: true, steer: true });
  f.swipe([{ x: 0, y: -70 }]);
  f.swipe([{ x: -70, y: 0 }]);
  expect(f.steer).not.toHaveBeenCalled();
  expect(f.discard).toHaveBeenCalledTimes(1);
});

it("retains tap and long-press actions", () => {
  const f = mount();
  const button = f.view.getByLabelText("Send message");
  fireEvent.press(button);
  fireEvent(button, "longPress");
  expect(f.press).toHaveBeenCalledTimes(1);
  expect(f.longPress).toHaveBeenCalledTimes(1);
  expect(f.discard).not.toHaveBeenCalled();
  expect(f.steer).not.toHaveBeenCalled();
});

it("plays only one threshold haptic per gesture", () => {
  const haptic = jest.spyOn(Haptics, "impactAsync");
  const f = mount();
  f.swipe([{ x: -60, y: 0 }, { x: -70, y: 0 }, { x: -10, y: 0 }, { x: -80, y: 0 }]);
  expect(haptic).toHaveBeenCalledTimes(1);
  haptic.mockRestore();
});
