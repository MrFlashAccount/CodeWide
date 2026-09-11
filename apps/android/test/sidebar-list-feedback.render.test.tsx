import { act, render } from "@testing-library/react-native";
import { SidebarListFeedback, sidebarListState } from "../src/ui/SidebarListFeedback";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it("stays blank for 300 ms and never shows an empty result during a slow load", () => {
  const view = render(<SidebarListFeedback state={{ status: "loading" }} archived={false} />);
  act(() => jest.advanceTimersByTime(299));
  expect(view.toJSON()).toBeNull();
  act(() => jest.advanceTimersByTime(1));
  expect(view.getByLabelText("Loading chats")).toBeVisible();
  expect(view.queryByText("No threads found")).toBeNull();
  act(() => jest.advanceTimersByTime(5000));
  expect(view.queryByText("No threads found")).toBeNull();
  view.rerender(<SidebarListFeedback state={{ status: "empty" }} archived={false} />);
  expect(view.getByText("No threads found")).toBeVisible();
  expect(view.queryByLabelText("Loading chats")).toBeNull();
});

it("does not flash an empty archive before the grace period or retain timers after rows arrive", () => {
  const view = render(<SidebarListFeedback state={{ status: "empty" }} archived />);
  expect(view.toJSON()).toBeNull();
  act(() => jest.advanceTimersByTime(300));
  expect(view.getByText("No archived threads")).toBeVisible();
  view.unmount();
  expect(jest.getTimerCount()).toBe(0);
});

it("distinguishes a failed read, an unresolved search and a confirmed empty result", () => {
  expect(sidebarListState("loading", null, false)).toEqual({ status: "loading" });
  expect(sidebarListState(undefined, null, false)).toEqual({ status: "loading" });
  expect(sidebarListState("ready", null, true)).toEqual({ status: "loading" });
  expect(sidebarListState("ready", null, false)).toEqual({ status: "empty" });
  const state = sidebarListState("error", "Server unavailable", false);
  const view = render(<SidebarListFeedback state={state} archived={false} />);
  act(() => jest.advanceTimersByTime(300));
  expect(view.getByRole("alert")).toHaveTextContent("Server unavailable");
  expect(view.queryByText("No threads found")).toBeNull();
});
