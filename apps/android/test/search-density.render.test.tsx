import { act, fireEvent, render } from "@testing-library/react-native";
import { ConversationSearchView } from "../src/presentation/conversation/ConversationSearchView";
import { ThreadListView } from "../src/presentation/navigation/ThreadListView";
import { searchFieldLayout } from "../src/presentation/input/searchLayout";
import { desktopThreadSidebarWidth } from "../src/presentation/layouts/windowLayout";

it("keeps catalog and conversation search on the same compact surface", () => {
  const change = jest.fn();
  const close = jest.fn();
  const catalog = render(<ThreadListView onOpen={jest.fn()} onChangeQuery={change} query="" rows={[]} />);
  const search = catalog.getByLabelText("Search threads");
  expect(catalog.getByTestId("thread-search-field")).toHaveStyle(searchFieldLayout);
  fireEvent.changeText(search, "activity");
  expect(change).toHaveBeenCalledWith("activity");
  catalog.unmount();

  const conversation = render(<ConversationSearchView matchCount={3} query="activity" onChangeText={change} onClose={close} />);
  expect(conversation.getByTestId("conversation-search-field")).toHaveStyle(searchFieldLayout);
  expect(conversation.getByText("3")).toBeVisible();
  fireEvent.press(conversation.getByLabelText("Close thread search"));
  expect(close).toHaveBeenCalledTimes(1);
});

it("gives the narrow split view more catalog room without consuming the conversation", () => {
  for (const width of [840, 900, 1024, 1440]) {
    const sidebar = desktopThreadSidebarWidth(width);
    expect(sidebar).toBeGreaterThanOrEqual(320);
    expect(sidebar).toBeLessThanOrEqual(480);
    expect(width - sidebar).toBeGreaterThanOrEqual(520);
  }
});

it("keeps the compact microphone actionable near the field edge", async () => {
  const activate = jest.fn(async () => {});
  const result = render(<ThreadListView onOpen={jest.fn()} rows={[]} voice={{ activate, disabled: false, state: "idle" }} />);
  const microphone = result.getByLabelText("Voice input");
  expect(microphone).toHaveStyle({ width: 32, height: 32, right: 2 });
  expect(microphone.props.hitSlop).toBe(8);
  await act(async () => fireEvent.press(microphone));
  expect(activate).toHaveBeenCalledTimes(1);
});
