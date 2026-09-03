import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { ThreadListView } from "../src/v2/presentation/navigation/ThreadListView";
import type {
  ThreadListRow,
  ThreadListRowActions,
} from "../src/v2/presentation/navigation/threadListTypes";

describe("V2 thread list", () => {
  it("filters by authoritative unread count", () => {
    render(
      <ThreadListView
        onOpen={() => undefined}
        rows={[row("read", 0, null), row("unread", 2, "activity-2")]}
      />,
    );

    fireEvent.press(screen.getByLabelText("Thread filters"));
    fireEvent.press(screen.getByLabelText("Thread filters: Unread"));

    expect(screen.queryByText("read")).toBeNull();
    expect(screen.getByText("unread")).toBeTruthy();
  });

  it("keeps an authoritative server-search hit even when its summary omits the term", () => {
    const match = { ...row("server-match", 0, null), authoritativeSearchMatch: true };
    render(<ThreadListView onOpen={() => undefined} query="needle" rows={[match]} />);

    expect(screen.getByText("server-match")).toBeTruthy();
  });

  it("opens the V1-compatible long-press menu and marks through the rendered marker", async () => {
    const actions = actionSpies();
    render(
      <ThreadListView
        actions={actions}
        onOpen={() => undefined}
        rows={[row("thread-a", 2, "activity-2")]}
      />,
    );

    fireEvent(screen.getByLabelText("Open thread thread-a thread-a"), "longPress");
    fireEvent.press(screen.getByLabelText("Thread actions: Mark as read"));

    await waitFor(() => expect(actions.markRead).toHaveBeenCalledWith("thread-a", "activity-2"));
  });

  it("exposes pin, read, and archive swipe actions without a row delete action", () => {
    const actions = actionSpies();
    render(
      <ThreadListView
        actions={actions}
        onOpen={() => undefined}
        rows={[row("thread-a", 1, "activity-1")]}
      />,
    );

    expect(screen.getByLabelText("Pin thread")).toBeTruthy();
    expect(screen.getByLabelText("Read thread")).toBeTruthy();
    expect(screen.getByLabelText("Archive thread")).toBeTruthy();
    expect(screen.queryByLabelText("Delete thread")).toBeNull();
  });

  it("keeps menu-backed rows stretched across the thread list", () => {
    render(
      <ThreadListView
        actions={actionSpies()}
        onOpen={() => undefined}
        rows={[row("thread-a", 0, null)]}
      />,
    );

    const trigger = screen.getByLabelText("Open thread thread-a thread-a");
    expect(StyleSheet.flatten(trigger.props.style)).toEqual(
      expect.objectContaining({ alignSelf: "stretch" }),
    );
  });

  it("prewarms a thread on press-in before navigation", () => {
    const onOpen = jest.fn();
    const onPrewarm = jest.fn();
    render(
      <ThreadListView onOpen={onOpen} onPrewarm={onPrewarm} rows={[row("thread-a", 0, null)]} />,
    );

    const thread = screen.getByLabelText("Open thread thread-a thread-a");
    fireEvent(thread, "pressIn");
    expect(onPrewarm).toHaveBeenCalledWith("thread-a");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("preserves a retained preview without presenting it as live running state", () => {
    const retained = { ...row("thread-a", 0, null), retained: true, state: "running" };
    render(<ThreadListView onOpen={() => undefined} rows={[retained]} />);

    expect(screen.getByText("Preview thread-a")).toBeTruthy();
    expect(screen.queryByTestId("v2-progress-shimmer")).toBeNull();
  });

  it.each([
    ["waitingForApproval", "Approval needed"],
    ["waitingForInput", "Waiting for input"],
    ["failed", "Failed"],
  ])("exposes %s as a distinct accessibility status without replacing preview", (state, status) => {
    const statusRow = { ...row("thread-a", 0, null), state };
    render(<ThreadListView onOpen={() => undefined} rows={[statusRow]} />);

    const thread = screen.getByLabelText("Open thread thread-a thread-a");
    expect(thread.props.accessibilityValue).toEqual({ text: status });
    expect(screen.getByText("Preview thread-a")).toBeTruthy();
  });

  it("shows honest progress while authoritative catalog search is still scanning", () => {
    render(
      <ThreadListView
        onOpen={() => undefined}
        paging={{
          canLoadMore: false,
          error: null,
          loading: true,
          loadingLabel: "Searching all threads… 440 checked",
          loadMore: async () => undefined,
        }}
        query="needle"
        rows={[]}
      />,
    );

    expect(screen.getByText("Searching all threads… 440 checked")).toBeTruthy();
  });

  it("keeps bounded authoritative search pageable when a page has no root results", () => {
    const loadMore = jest.fn(async () => undefined);
    render(
      <ThreadListView
        onOpen={() => undefined}
        paging={{
          canLoadMore: true,
          error: null,
          loading: false,
          loadingLabel: "Searching threads…",
          loadMore,
        }}
        query="needle"
        rows={[]}
      />,
    );

    fireEvent.press(screen.getByLabelText("Load more search results"));
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it("clears a failed row action, reports the error, and permits retry", async () => {
    const actions = actionSpies();
    const onActionError = jest.fn();
    actions.archive = jest
      .fn<ThreadListRowActions["archive"]>()
      .mockRejectedValueOnce(new Error("Archive was rejected"))
      .mockResolvedValue(undefined);
    render(
      <ThreadListView
        actions={actions}
        onActionError={onActionError}
        onOpen={() => undefined}
        rows={[row("thread-a", 0, null)]}
      />,
    );
    const thread = screen.getByLabelText("Open thread thread-a thread-a");

    fireEvent(thread, "longPress");
    await act(async () => fireEvent.press(screen.getByLabelText("Thread actions: Archive")));

    expect(onActionError).toHaveBeenCalledWith("Archive was rejected");
    expect(screen.getByText("Preview thread-a")).toBeTruthy();

    fireEvent(thread, "longPress");
    await act(async () => fireEvent.press(screen.getByLabelText("Thread actions: Archive")));
    expect(actions.archive).toHaveBeenCalledTimes(2);
  });
});

function actionSpies(): ThreadListRowActions {
  return {
    archive: jest.fn(() => Promise.resolve()),
    copyId: jest.fn(() => Promise.resolve()),
    markRead: jest.fn(() => Promise.resolve()),
    togglePin: jest.fn(() => Promise.resolve()),
  };
}

function row(id: string, unread: number, marker: string | null): ThreadListRow {
  return {
    archived: false,
    id,
    latestActivityMarker: marker,
    pinned: false,
    preview: `Preview ${id}`,
    retained: false,
    state: "completed",
    title: id,
    unread,
    updatedAt: "12:00",
  };
}
