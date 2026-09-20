import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { GlobalSearchScreen } from "../src/features/search/GlobalSearchScreen";
import { SearchSession } from "../src/features/search/search-session";
import type { MessageSearchPage } from "../src/data/message-search";
import type {
  VoiceInputRow,
  WorkspaceResourceDatabase,
} from "../src/data/workspace-resource-database";
import * as nativeTransport from "../src/native/native-transport";
import { useContext } from "react";
import { StyleSheet, Text } from "react-native";
import {
  SearchHighlightQuery,
  SearchMessage,
  SearchMessageFocus,
} from "../src/rendering/SearchMessageFocus";
import { colors, controlHitSlop, controlSize, spacing, touchTarget } from "../src/theme";
import { searchFieldLayout } from "../src/presentation/input/searchLayout";
import { threadListLayout } from "../src/ui/thread-list-layout";
import { filterIconButtonLayout } from "../src/presentation/input/filterIconButtonLayout";
import type { AppVoiceInputController, AppVoiceInputRuntime } from "../src/ui/VoiceInputRuntime";
import { getAppDialogRequest, invokeAppDialogAction, resetAppDialog } from "./mocks/AppDialog";

let sequence = 0;

afterEach(() => {
  jest.restoreAllMocks();
  resetAppDialog();
});

interface QueryProbeProps {
  readonly label: string;
}
function QueryProbe(props: QueryProbeProps) {
  const query = useContext(SearchHighlightQuery);
  return <Text>{`${props.label}:${query}`}</Text>;
}

it("highlights only the selected message identity even when neighboring text is identical", () => {
  const view = render(
    <SearchMessageFocus.Provider
      value={{ itemId: "second", query: "repeated", onLayout: jest.fn() }}
    >
      <SearchMessage itemId="first">
        <QueryProbe label="first" />
      </SearchMessage>
      <SearchMessage itemId="second">
        <QueryProbe label="second" />
      </SearchMessage>
    </SearchMessageFocus.Provider>,
  );
  expect(view.getByText("first:")).toBeTruthy();
  expect(view.getByText("second:repeated")).toBeTruthy();
  expect(view.getAllByTestId("search-message-target")).toHaveLength(1);
});

type SearchVoiceOutcome = "cancel" | "error" | "success";

class SearchVoiceController implements AppVoiceInputController {
  private binding: Parameters<AppVoiceInputController["bind"]>[0] | null = null;
  private readonly outcome: SearchVoiceOutcome;
  private readonly voiceInputs: ReturnType<typeof voiceCollection>;
  readonly sent: string[] = [];

  constructor(voiceInputs: ReturnType<typeof voiceCollection>, outcome: SearchVoiceOutcome) {
    this.voiceInputs = voiceInputs;
    this.outcome = outcome;
  }

  bind(binding: Parameters<AppVoiceInputController["bind"]>[0]): void {
    this.binding = {
      ...binding,
      send: (text) => {
        this.sent.push(text);
        binding.send(text);
      },
    };
    this.publish(binding.scope, "idle", null, false);
  }

  toggle(scope: string): Promise<void> {
    this.publish(scope, "recording", null, false);
    return Promise.resolve();
  }

  finish(scope: string): Promise<void> {
    if (this.outcome === "success") {
      this.binding?.updateDraft("dictated query");
      this.publish(scope, "idle", null, false);
      return Promise.resolve();
    }
    if (this.outcome === "cancel") {
      this.publish(scope, "idle", null, false);
      return Promise.resolve();
    }
    this.publish(scope, "idle", "Transcription failed", true);
    return Promise.reject(new Error("Transcription failed"));
  }

  retry(_scope: string): Promise<void> {
    return Promise.resolve();
  }

  unbind(scope: string): void {
    if (this.binding?.scope === scope) {
      this.binding = null;
    }
  }

  clearPendingSelection(_scope: string): void {}

  level(_scope: string): number {
    return 0;
  }

  subscribeLevel(_scope: string, _listener: () => void): () => void {
    return () => {};
  }

  private publish(
    scope: string,
    phase: "idle" | "recording",
    error: string | null,
    retryAvailable: boolean,
  ): void {
    const row: VoiceInputRow = {
      backend: "remote",
      error,
      id: scope,
      level: 0,
      pendingSelection: null,
      phase,
      retryAvailable,
      scope,
      seconds: 0,
      updatedAt: Date.now(),
    };
    if (this.voiceInputs.has(scope)) {
      this.voiceInputs.update(scope, (draft) => {
        Object.assign(draft, row);
      });
    } else {
      this.voiceInputs.insert(row);
    }
  }
}

function voiceCollection() {
  return createCollection(
    localOnlyCollectionOptions<VoiceInputRow, string>({
      getKey: (row) => row.id,
      id: `search-voice-test:${String(++sequence)}`,
    }),
  );
}

function voiceFixture(outcome: SearchVoiceOutcome): {
  controller: SearchVoiceController;
  runtime: AppVoiceInputRuntime;
} {
  const voiceInputs = voiceCollection();
  const controller = new SearchVoiceController(voiceInputs, outcome);
  // WHY: Search consumes only voiceInputs from this runtime; constructing unrelated native-backed test databases would cross this fixture's boundary.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const resources = { voiceInputs } as WorkspaceResourceDatabase;
  return {
    controller,
    runtime: {
      controller,
      resources,
      scopePrefix: "search-test",
      thread: null,
    },
  };
}

function setup(voiceRuntime: AppVoiceInputRuntime | null = null) {
  const session = new SearchSession(`render-test:${++sequence}`);
  const searchMessages = jest
    .fn<Promise<MessageSearchPage>, [string, unknown]>()
    .mockResolvedValue({
      data: [
        {
          messageId: 24,
          threadId: "chat-one",
          turnId: "turn-old",
          title: "Matching chat",
          project: "/project",
          timestamp: "2026-09-06T10:00:00Z",
          sourceOffset: 200,
          kind: "agent_message",
          excerpt: "A hello message",
        },
      ],
      nextOffset: null,
      indexing: false,
      failedSources: 0,
    });
  const onClose = jest.fn();
  const onOpenThread = jest.fn();
  const screen = (
    <GlobalSearchScreen
      remote={{ searchMessages }}
      session={session}
      servers={[{ id: "one", name: "Buddy" }]}
      threads={[{ id: "chat-one", serverId: "one", title: "First chat" }]}
      projects={[]}
      onClose={onClose}
      onOpenThread={onOpenThread}
      voiceRuntime={voiceRuntime}
    />
  );
  return {
    view: render(screen),
    screen,
    session,
    searchMessages,
    onClose,
    onOpenThread,
  };
}

it("keeps expanded search on the compact sidebar field geometry", () => {
  const test = setup();
  const header = test.view.getByTestId("global-search-header-row");
  expect(within(header).getByText("Search")).toBeTruthy();
  expect(within(header).getByLabelText("Search filters")).toBeTruthy();
  expect(
    within(test.view.getByTestId("search-top-input")).queryByLabelText("Search filters"),
  ).toBeNull();
  expect(test.view.getByTestId("expanded-thread-search-field")).toHaveStyle({
    ...searchFieldLayout,
    height: controlSize.regular,
  });
  expect(test.view.getByLabelText("Search all messages")).toHaveStyle({
    height: controlSize.regular,
    padding: 0,
  });
  expect(test.view.getByLabelText("Search filters")).toHaveStyle({
    ...filterIconButtonLayout,
  });
  expect(
    StyleSheet.flatten(test.view.getByLabelText("Search filters").props.style).backgroundColor,
  ).toBeUndefined();
  expect(test.view.getByTestId("search-top-input")).toHaveStyle({
    paddingLeft: spacing.md,
    paddingRight: threadListLayout.edgeInset,
    paddingBottom: spacing.xs,
    gap: spacing.optical,
  });
});

it("keeps navigation, clear, filter and microphone targets distinct and accessible", () => {
  const voice = voiceFixture("success");
  const test = setup(voice.runtime);
  expect(test.view.getByLabelText("Back to threads")).toHaveStyle({
    minHeight: touchTarget,
    width: touchTarget,
  });
  expect(test.view.getByLabelText("Search filters")).toHaveStyle({
    minHeight: touchTarget,
    width: touchTarget,
  });
  expect(test.view.getByLabelText("Allow microphone access")).toHaveProp(
    "hitSlop",
    controlHitSlop.compact,
  );
  fireEvent.changeText(test.view.getByLabelText("Search all messages"), "query");
  expect(test.view.getByLabelText("Clear search query")).toHaveStyle({
    height: controlSize.regular,
    width: controlSize.regular,
  });
  expect(test.view.getByLabelText("Clear search query")).toHaveProp(
    "hitSlop",
    controlHitSlop.regular,
  );
});

it("keeps query clearing separate from closing search", () => {
  const test = setup();
  expect(test.view.queryByLabelText("Clear search query")).toBeNull();
  fireEvent.changeText(test.view.getByLabelText("Search all messages"), "hello");
  fireEvent.press(test.view.getByLabelText("Clear search query"));
  expect(test.view.getByLabelText("Search all messages")).toHaveProp("value", "");
  expect(test.view.queryByLabelText("Clear search query")).toBeNull();
  expect(test.onClose).not.toHaveBeenCalled();
  expect(test.view.getByTestId("sidebar-search")).toBeTruthy();
});

it("opens an actual chat result directly and keeps Back separate from navigation", async () => {
  const test = setup();
  expect(test.view.getByTestId("search-top-input")).toBeTruthy();
  expect(test.view.queryByTestId("search-bottom-dock")).toBeNull();
  fireEvent.changeText(test.view.getByLabelText("Search all messages"), "hello");
  fireEvent(test.view.getByLabelText("Search all messages"), "submitEditing");
  await waitFor(() => expect(test.view.getByText("Matching chat")).toBeTruthy());
  fireEvent.press(test.view.getByText("Matching chat"));
  expect(test.onOpenThread).toHaveBeenCalledWith(
    expect.objectContaining({
      connectionId: "one",
      hit: expect.objectContaining({ messageId: 24, turnId: "turn-old" }),
    }),
    "hello",
  );
  expect(test.onClose).not.toHaveBeenCalled();
  expect(test.view.queryByText("Open live chat")).toBeNull();
  fireEvent.press(test.view.getByLabelText("Back to threads"));
  expect(test.onClose).toHaveBeenCalledTimes(1);
  expect(test.onOpenThread).toHaveBeenCalledTimes(1);
});

it("uses the ordinary transparent filter button states", () => {
  const test = setup();
  const filter = test.view.getByLabelText("Search filters");
  expect(filter.props.accessibilityState).toEqual({ expanded: false, selected: false });
  expect(test.view.getByText("filter-outline")).toBeTruthy();
  act(() => {
    test.session.filters$.serverId.set("one");
  });
  expect(test.view.getByLabelText("Search filters").props.accessibilityState).toEqual({
    expanded: false,
    selected: true,
  });
  expect(test.view.getByText("filter")).toBeTruthy();
});

it("dictates into the query without sending or closing search", async () => {
  jest.spyOn(nativeTransport, "getMicrophonePermission").mockReturnValue("granted");
  const voice = voiceFixture("success");
  const test = setup(voice.runtime);
  fireEvent.changeText(test.view.getByLabelText("Search all messages"), "typed query");
  fireEvent.press(test.view.getByLabelText("Voice input"));
  await waitFor(() => expect(test.view.getByLabelText("Stop voice input")).toBeTruthy());
  fireEvent.press(test.view.getByLabelText("Stop voice input"));
  await waitFor(() =>
    expect(test.view.getByLabelText("Search all messages")).toHaveProp("value", "dictated query"),
  );
  expect(voice.controller.sent).toEqual([]);
  expect(test.onOpenThread).not.toHaveBeenCalled();
  expect(test.onClose).not.toHaveBeenCalled();
  expect(test.view.getByTestId("sidebar-search")).toBeTruthy();
});

it("preserves the query when microphone permission is denied", () => {
  jest.spyOn(nativeTransport, "getMicrophonePermission").mockReturnValue("denied");
  const voice = voiceFixture("success");
  const test = setup(voice.runtime);
  fireEvent.changeText(test.view.getByLabelText("Search all messages"), "keep this");
  fireEvent.press(test.view.getByLabelText("Allow microphone access"));
  expect(getAppDialogRequest()?.title).toBe("Microphone access");
  invokeAppDialogAction("Not now");
  expect(test.view.getByLabelText("Search all messages")).toHaveProp("value", "keep this");
  expect(test.view.getByTestId("sidebar-search")).toBeTruthy();
});

it.each([
  ["cancel", "cancelled dictation"],
  ["error", "failed dictation"],
] as const)("preserves the query after %s", async (outcome, query) => {
  jest.spyOn(nativeTransport, "getMicrophonePermission").mockReturnValue("granted");
  const voice = voiceFixture(outcome);
  const test = setup(voice.runtime);
  fireEvent.changeText(test.view.getByLabelText("Search all messages"), query);
  fireEvent.press(test.view.getByLabelText("Voice input"));
  await waitFor(() => expect(test.view.getByLabelText("Stop voice input")).toBeTruthy());
  fireEvent.press(test.view.getByLabelText("Stop voice input"));
  await waitFor(() =>
    expect(test.view.getByLabelText("Search all messages")).toHaveProp("value", query),
  );
  expect(test.onClose).not.toHaveBeenCalled();
  expect(test.view.getByTestId("sidebar-search")).toBeTruthy();
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
