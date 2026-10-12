import { act, render } from "@testing-library/react-native";

import { threadSummaryKey } from "../src/data/thread-summary-projection";
import { threadLiveActivity$ } from "../src/data/threadLiveActivity";
import { ThreadRowContent } from "../src/features/threadList/ThreadRowContent";
import { AppText } from "../src/ui/AppText";

const thread = {
  id: "thread",
  pinned: false,
  preview: "Latest answer",
  serverId: "server",
  title: "Thread",
  unread: 0,
};
const key = threadSummaryKey("server", "thread");

afterEach(() => {
  act(() => {
    threadLiveActivity$[key]?.delete();
  });
});

it("shows the reasoning step without shimmer while running and the preview once it clears", () => {
  const view = render(<ThreadRowContent selected={false} thread={{ ...thread, state: "running" }} />);
  expect(view.getByTestId("thread-preview")).toHaveTextContent("Latest answer");

  act(() => {
    threadLiveActivity$[key]?.set({ kind: "reasoning", title: "Inspecting tests" });
  });
  expect(view.getByTestId("thread-live-activity")).toHaveTextContent("Inspecting tests");
  expect(view.queryByTestId("thread-preview")).toBeNull();
  expect(
    view.UNSAFE_getAllByType(AppText).find((node) => node.props.testID === "thread-live-activity")
      ?.props.shimmering,
  ).not.toBe(true);

  act(() => {
    threadLiveActivity$[key]?.set({ command: "cargo test", kind: "command" });
  });
  expect(view.queryByTestId("thread-live-activity")).toBeNull();
  expect(view.getByTestId("thread-preview")).toHaveTextContent("Latest answer");

  act(() => {
    threadLiveActivity$[key]?.delete();
  });
  expect(view.queryByTestId("thread-live-activity")).toBeNull();
  expect(view.getByTestId("thread-preview")).toHaveTextContent("Latest answer");
});

it("keeps the preview for a thread that is not running", () => {
  act(() => {
    threadLiveActivity$[key]?.set({ kind: "webSearch" });
  });
  const view = render(<ThreadRowContent selected={false} thread={thread} />);
  expect(view.getByTestId("thread-preview")).toHaveTextContent("Latest answer");
  expect(view.queryByTestId("thread-live-activity")).toBeNull();
});
