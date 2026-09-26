import { act, fireEvent, render, renderHook } from "@testing-library/react-native";
import { JumpToLatest } from "../src/features/conversation/timeline/JumpToLatest";
import { TimelineJumpVisibility } from "../src/features/conversation/timeline/timelineJumpVisibility";
import { useTimelineViewportState } from "../src/features/conversation/timeline/timelineViewport";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it("renders only sustained distance changes without rerendering the conversation owner", () => {
  const visibility = new TimelineJumpVisibility();
  const jump = jest.fn();
  const renderParent = jest.fn();
  function Parent() {
    renderParent();
    return (
      <JumpToLatest
        bottomChromeHeight={0}
        jumpTimelineToLatest={jump}
        jumpVisibility={visibility}
        newItemCount={2}
      />
    );
  }
  const view = render(<Parent />);
  expect(view.queryByTestId("jump-to-latest")).toBeNull();
  act(() => {
    visibility.update(100, true);
    jest.advanceTimersByTime(199);
  });
  expect(view.queryByTestId("jump-to-latest")).toBeNull();
  act(() => jest.advanceTimersByTime(1));
  fireEvent.press(view.getByTestId("jump-to-latest"));
  expect(view.getByLabelText("Jump to latest, 2 new turns")).toBeTruthy();
  expect(jump).toHaveBeenCalledTimes(1);
  act(() => visibility.update(12, true));
  expect(view.queryByTestId("jump-to-latest")).toBeNull();
  expect(renderParent).toHaveBeenCalledTimes(1);
});

it("cancels transient streaming excursions before the button is mounted", () => {
  const visibility = new TimelineJumpVisibility();
  const view = render(
    <JumpToLatest
      bottomChromeHeight={0}
      jumpTimelineToLatest={jest.fn()}
      jumpVisibility={visibility}
      newItemCount={0}
    />,
  );
  act(() => {
    visibility.update(100, true);
    jest.advanceTimersByTime(100);
    visibility.update(0, true);
    jest.advanceTimersByTime(500);
  });
  expect(view.queryByTestId("jump-to-latest")).toBeNull();
});

it("isolates pending visibility when switching chats and cancels it on unmount", () => {
  const hook = renderHook((scope: string) => useTimelineViewportState(scope), {
    initialProps: "first",
  });
  const first = hook.result.current.jumpVisibility;
  act(() => {
    first.update(100, true);
    jest.advanceTimersByTime(100);
  });
  hook.rerender("second");
  const second = hook.result.current.jumpVisibility;
  act(() => jest.advanceTimersByTime(200));
  expect(first.visible$.get()).toBe(false);
  expect(second.visible$.get()).toBe(false);
  act(() => second.update(100, true));
  hook.unmount();
  act(() => jest.advanceTimersByTime(200));
  expect(second.visible$.get()).toBe(false);
});
