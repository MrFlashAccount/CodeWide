import { act, fireEvent, render } from "@testing-library/react-native";
import {
  SidebarListFeedback,
  sidebarListState,
  ThreadListPageError,
} from "../src/features/threadList/SidebarListFeedback";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it("stays blank for 300 ms and never shows an empty result during a slow load", () => {
  const view = render(<SidebarListFeedback state={{ status: "loading" }} archived={false} />);
  act(() => jest.advanceTimersByTime(299));
  expect(view.toJSON()).toBeNull();
  act(() => jest.advanceTimersByTime(1));
  expect(view.getByLabelText("Loading threads")).toBeVisible();
  expect(view.getByTestId("thread-list-skeleton")).toBeVisible();
  expect(view.queryByText("No threads found")).toBeNull();
  act(() => jest.advanceTimersByTime(5000));
  expect(view.queryByText("No threads found")).toBeNull();
  view.rerender(<SidebarListFeedback state={{ status: "empty" }} archived={false} />);
  expect(view.getByText("No threads found")).toBeVisible();
  expect(view.queryByLabelText("Loading threads")).toBeNull();
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
  expect(sidebarListState("loading", null)).toEqual({ status: "loading" });
  expect(sidebarListState(undefined, null)).toEqual({ status: "loading" });
  // A completed local view stays visible independently of transport reconnects.
  expect(sidebarListState("ready", null)).toEqual({ status: "empty" });
  const state = sidebarListState("error", "Server unavailable");
  const view = render(<SidebarListFeedback state={state} archived={false} />);
  act(() => jest.advanceTimersByTime(300));
  expect(view.getByRole("alert")).toHaveTextContent("Server unavailable");
  expect(view.queryByText("No threads found")).toBeNull();
});

it("keeps loaded rows recoverable after a continuation fails", () => {
  const retry = jest.fn();
  const view = render(<ThreadListPageError message="Server unavailable" onRetry={retry} />);

  expect(view.getByRole("alert")).toHaveTextContent("Server unavailable");
  fireEvent.press(view.getByRole("button", { name: "Retry loading chats" }));
  expect(retry).toHaveBeenCalledTimes(1);
});
