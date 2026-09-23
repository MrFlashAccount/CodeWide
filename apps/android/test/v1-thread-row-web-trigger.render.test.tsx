import { act, fireEvent, render } from "@testing-library/react-native";

import { ThreadRowLinkTrigger } from "../src/features/threadList/ThreadRowLinkTrigger.web";

function mount() {
  const prepare = jest.fn();
  const followLink = jest.fn();
  const openMenu = jest.fn();
  const view = render(
    <ThreadRowLinkTrigger
      accessibilityLabel="Open thread"
      accessibilityRole="link"
      onClick={followLink}
      onLongPress={openMenu}
      onPress={prepare}
      selected={false}
      swipeEnabled={false}
    />,
  );
  return { followLink, openMenu, prepare, trigger: view.getByRole("link") };
}

function pointer(id: number, x: number, y: number) {
  return { nativeEvent: { button: 0, clientX: x, clientY: y, pointerId: id } };
}

function click() {
  return {
    altKey: false,
    button: 0,
    ctrlKey: false,
    defaultPrevented: false,
    detail: 1,
    metaKey: false,
    preventDefault: jest.fn(),
    shiftKey: false,
  };
}

it("prepares and follows a link on a short browser tap", () => {
  const { followLink, prepare, trigger } = mount();
  fireEvent(trigger, "pointerDown", pointer(1, 10, 10));
  fireEvent(trigger, "pointerUp", pointer(1, 10, 10));
  fireEvent(trigger, "click", click());
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(followLink).toHaveBeenCalledTimes(1);
  expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(followLink.mock.invocationCallOrder[0]);
});

it("does not follow a link after the pointer moves past the tap threshold", () => {
  const { followLink, prepare, trigger } = mount();
  const event = click();
  fireEvent(trigger, "pointerDown", pointer(1, 10, 10));
  fireEvent(trigger, "pointerMove", pointer(1, 10, 19));
  fireEvent(trigger, "pointerUp", pointer(1, 10, 19));
  fireEvent(trigger, "click", event);
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  expect(prepare).not.toHaveBeenCalled();
  expect(followLink).not.toHaveBeenCalled();
});

it("opens the menu on long press without following the link", () => {
  jest.useFakeTimers();
  try {
    const { followLink, openMenu, prepare, trigger } = mount();
    const event = click();
    fireEvent(trigger, "pointerDown", pointer(1, 10, 10));
    act(() => jest.advanceTimersByTime(350));
    fireEvent(trigger, "pointerUp", pointer(1, 10, 10));
    fireEvent(trigger, "click", event);
    expect(openMenu).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(prepare).not.toHaveBeenCalled();
    expect(followLink).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
