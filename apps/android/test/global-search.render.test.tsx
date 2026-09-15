import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { HeroUINativeProviderRaw } from "heroui-native/provider-raw";
import { PortalHost } from "heroui-native/portal";
import { GlobalSearchScreen } from "../src/features/search/GlobalSearchScreen";
import { SearchSession } from "../src/features/search/search-session";
import type { MessageSearchPage } from "../src/data/message-search";
import { useContext } from "react";
import { Text } from "react-native";
import { SearchHighlightQuery, SearchMessage, SearchMessageFocus } from "../src/rendering/SearchMessageFocus";
import { colors, controlSize, spacing } from "../src/theme";
import { searchFieldLayout } from "../src/presentation/input/searchLayout";
import { threadListLayout } from "../src/ui/thread-list-layout";

let sequence = 0;
interface QueryProbeProps { readonly label: string }
function QueryProbe(props: QueryProbeProps) {
  const query = useContext(SearchHighlightQuery);
  return <Text>{`${props.label}:${query}`}</Text>;
}

it("highlights only the selected message identity even when neighboring text is identical", () => {
  const view = render(<SearchMessageFocus.Provider value={{ itemId: "second", query: "repeated", onLayout: jest.fn() }}>
    <SearchMessage itemId="first"><QueryProbe label="first" /></SearchMessage>
    <SearchMessage itemId="second"><QueryProbe label="second" /></SearchMessage>
  </SearchMessageFocus.Provider>);
  expect(view.getByText("first:")).toBeTruthy();
  expect(view.getByText("second:repeated")).toBeTruthy();
  expect(view.getAllByTestId("search-message-target")).toHaveLength(1);
});

function setup() {
  const session = new SearchSession(`render-test:${++sequence}`);
  const searchMessages = jest.fn<Promise<MessageSearchPage>, [string, unknown]>().mockResolvedValue({
    data: [{ messageId: 24, threadId: "chat-one", turnId: "turn-old", title: "Matching chat", project: "/project", timestamp: "2026-09-06T10:00:00Z", sourceOffset: 200, kind: "agent_message", excerpt: "A hello message" }],
    nextOffset: null, indexing: false, failedSources: 0,
  });
  const onClose = jest.fn();
  const onOpenThread = jest.fn();
  const screen = <HeroUINativeProviderRaw config={{ animation: "disable-all", devInfo: { stylingPrinciples: false } }}><GlobalSearchScreen remote={{ searchMessages }} session={session}
    servers={[{ id: "one", name: "Buddy" }]} threads={[{ id: "chat-one", serverId: "one", title: "First chat" }]} projects={[]}
    onClose={onClose} onOpenThread={onOpenThread} /><PortalHost /></HeroUINativeProviderRaw>;
  return { view: render(screen), screen, session, searchMessages, onClose, onOpenThread };
}

it("keeps expanded search on the compact sidebar field geometry", () => {
  const test = setup();
  expect(test.view.getByTestId("expanded-thread-search-field")).toHaveStyle({ ...searchFieldLayout, height: controlSize.regular });
  expect(test.view.getByLabelText("Search all messages")).toHaveStyle({ height: controlSize.regular, padding: 0 });
  expect(test.view.getByLabelText("Search filters")).toHaveStyle({ width: controlSize.touch, minHeight: controlSize.touch });
  expect(test.view.getByTestId("search-top-input")).toHaveStyle({ paddingLeft: spacing.md, paddingRight: threadListLayout.edgeInset, paddingBottom: spacing.xs, gap: spacing.optical });
});

it("opens an actual chat result directly and keeps closing search separate from navigation", async () => {
  const test = setup();
  expect(test.view.getByTestId("search-top-input")).toBeTruthy();
  expect(test.view.queryByTestId("search-bottom-dock")).toBeNull();
  fireEvent.changeText(test.view.getByLabelText("Search all messages"), "hello");
  fireEvent(test.view.getByLabelText("Search all messages"), "submitEditing");
  await waitFor(() => expect(test.view.getByText("Matching chat")).toBeTruthy());
  fireEvent.press(test.view.getByText("Matching chat"));
  expect(test.onOpenThread).toHaveBeenCalledWith(expect.objectContaining({ connectionId: "one", hit: expect.objectContaining({ messageId: 24, turnId: "turn-old" }) }), "hello");
  expect(test.onClose).not.toHaveBeenCalled();
  expect(test.view.queryByText("Open live chat")).toBeNull();
  fireEvent.press(test.view.getByLabelText("Close search"));
  expect(test.onClose).toHaveBeenCalledTimes(1);
  expect(test.onOpenThread).toHaveBeenCalledTimes(1);
});

it("restores query, results and scroll when the mobile sidebar remounts", async () => {
  const test = setup();
  fireEvent.changeText(test.view.getByLabelText("Search all messages"), "hello");
  fireEvent(test.view.getByLabelText("Search all messages"), "submitEditing");
  await waitFor(() => expect(test.view.getByText("Matching chat")).toBeTruthy());
  test.session.rememberScroll(420);
  test.view.unmount();
  const reopened = render(test.screen);
  expect(reopened.getByDisplayValue("hello")).toBeTruthy();
  expect(reopened.getByText("Matching chat")).toBeTruthy();
  expect(test.session.scrollOffset).toBe(420);
  expect(test.searchMessages).toHaveBeenCalledTimes(1);
});

it("does not submit empty input or disguise connection failure as no matches", async () => {
  const test = setup();
  fireEvent(test.view.getByLabelText("Search all messages"), "submitEditing");
  expect(test.searchMessages).not.toHaveBeenCalled();
  test.searchMessages.mockRejectedValue(new Error("Server disconnected"));
  fireEvent.changeText(test.view.getByLabelText("Search all messages"), "hello");
  fireEvent(test.view.getByLabelText("Search all messages"), "submitEditing");
  await waitFor(() => expect(test.view.getByText("Buddy: Server disconnected")).toBeTruthy());
  expect(test.view.queryByText("No matches")).toBeNull();
});

it("shows incomplete indexing as a compact neutral note without hiding results", async () => {
  const test = setup();
  const response = await test.searchMessages("one", {});
  test.searchMessages.mockResolvedValue({ ...response, failedSources: 11 });
  fireEvent.changeText(test.view.getByLabelText("Search all messages"), "hello");
  fireEvent(test.view.getByLabelText("Search all messages"), "submitEditing");
  const note = await test.view.findByText("Buddy · 11 chats not indexed");
  expect(note).toHaveStyle({ color: colors.textMuted });
  expect(note.props.numberOfLines).toBe(1);
  expect(note.props.accessibilityLabel).toContain("Results are incomplete");
  expect(test.view.queryByRole("alert")).toBeNull();
  fireEvent.press(test.view.getByText("Matching chat"));
  expect(test.onOpenThread).toHaveBeenCalledTimes(1);
});
