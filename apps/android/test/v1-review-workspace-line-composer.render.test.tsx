import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import type { EnrichedMarkdownTextInputProps } from "react-native-enriched-markdown";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { CodeReviewComment } from "../src/features/review/comments/reviewComment";
import type { CodeReviewWorkspaceProps } from "../src/features/review/workspace/codeReviewContract";
import { CodeReviewWorkspace } from "../src/features/review/workspace/CodeReviewWorkspace";
import { latestWebViewProps, webViewPostedMessages } from "./mocks/ReactNativeWebView";

// WHY: Expo's filesystem bridge cannot initialize in Node; the editor's suggestion popup imports it.
jest.mock("expo-file-system/legacy", () => ({ cacheDirectory: null }));

// WHY: The native Markdown editor requires Fabric. This adapter replaces only its platform view;
// typing is simulated through the same text and Markdown events the native editor emits.
jest.mock("react-native-enriched-markdown", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View: MockView } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    EnrichedMarkdownTextInput: React.forwardRef(function Editor(
      props: EnrichedMarkdownTextInputProps,
      ref,
    ) {
      React.useImperativeHandle(ref, () => ({
        focus: jest.fn(),
        getMarkdown: async () => Promise.resolve(""),
        setSelection: jest.fn(),
        setValue: jest.fn(),
      }));
      return <MockView {...props} testID="native-editor" />;
    }),
  };
});

// Compose owns the modal window on Android. Keep its children interactive in the native renderer.
jest.mock("../src/ui/AppSheet", () => {
  const { View, ScrollView } = jest.requireActual<typeof import("react-native")>("react-native");
  return { AppSheet: View, AppSheetScrollView: ScrollView };
});

const PATH = "/repo/src/a.ts";

function revealedLocations(): unknown[] {
  const locations: unknown[] = [];
  for (const serialized of webViewPostedMessages) {
    const message: unknown = JSON.parse(serialized);
    if (
      typeof message === "object" &&
      message !== null &&
      "command" in message &&
      message.command === "reveal" &&
      "payload" in message
    ) {
      locations.push(message.payload);
    }
  }
  return locations;
}

function documentRequestId(): number | null {
  for (const serialized of webViewPostedMessages.toReversed()) {
    const message: unknown = JSON.parse(serialized);
    if (
      typeof message === "object" &&
      message !== null &&
      "command" in message &&
      message.command === "document" &&
      "payload" in message &&
      typeof message.payload === "object" &&
      message.payload !== null &&
      "requestId" in message.payload &&
      typeof message.payload.requestId === "number" &&
      "document" in message.payload &&
      message.payload.document !== null
    ) {
      return message.payload.requestId;
    }
  }
  return null;
}

/** The current-thread workspace with one changed file, ready to take line taps. */
async function renderWorkspace(
  attached: (readonly CodeReviewComment[])[],
  overrides: Partial<CodeReviewWorkspaceProps> = {},
): Promise<ReturnType<typeof render>> {
  const view = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 900, width: 420, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <CodeReviewWorkspace
        changes={[
          {
            additions: 1,
            availability: "available",
            deletions: 0,
            itemId: "item-1",
            kind: "update",
            path: PATH,
            turnId: "turn-1",
          },
        ]}
        cwd="/repo"
        getTransferAccess={async () => Promise.reject(new Error("not part of this test"))}
        onAttach={async (comments) => {
          attached.push(comments);
          return Promise.resolve(false);
        }}
        onClose={() => undefined}
        sourceOverrides={{ [PATH]: "const a = 1;\nconst b = 2;\n" }}
        thread={null}
        voiceRuntime={null}
        {...overrides}
      />
    </SafeAreaProvider>,
  );
  await act(async () => {
    latestWebViewProps?.onMessage?.({
      nativeEvent: { data: JSON.stringify({ type: "ready", version: 1 }) },
    });
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(documentRequestId()).not.toBeNull();
  });

  return view;
}

async function tapLine(reference: Readonly<Record<string, unknown>>): Promise<void> {
  await act(async () => {
    latestWebViewProps?.onMessage?.({
      nativeEvent: {
        data: JSON.stringify({
          reference,
          requestId: documentRequestId(),
          type: "lineTap",
          version: 1,
        }),
      },
    });
    await Promise.resolve();
  });
}

it("the native file controls stay usable across a delayed file and a compact picker", async () => {
  webViewPostedMessages.length = 0;
  const second = "/repo/src/b.ts";
  let releaseDiff = () => {};
  const pending = new Promise<void>((resolve) => {
    releaseDiff = resolve;
  });
  const view = await renderWorkspace([], {
    changes: [PATH, second].map((path) => ({
      path,
      additions: 1,
      availability: "available",
      deletions: 0,
      itemId: path,
      kind: "update",
      turnId: "turn",
    })),
    onLoadDiff: async (path) => {
      if (path === second) await pending;
      return { path, patches: [], source: "const value = 1;", truncated: false, totalBytes: 0 };
    },
  });
  function layout(width: number) {
    fireEvent(view.getByTestId("code-review-workspace"), "layout", {
      nativeEvent: { layout: { width } },
    });
  }
  layout(740);
  expect(view.getByLabelText("Previous file")).toBeDisabled();
  fireEvent.press(view.getByLabelText("Next file"));
  expect(view.getByText("b.ts")).toBeVisible();
  expect(view.getByLabelText("Next file")).toBeDisabled();
  expect(view.queryByText("Loading file…")).toBeNull();
  fireEvent.press(view.getByLabelText("Hide file list"));
  fireEvent.press(view.getByLabelText("Show file list"));
  fireEvent.press(view.getByLabelText("Previous file"));
  await act(async () => {
    releaseDiff();
    await pending;
  });
  expect(view.getByText("a.ts")).toBeVisible();
  expect(view.getByText("1 / 2")).toBeVisible();

  layout(390);
  fireEvent.press(view.getByLabelText("Choose file, a.ts"));
  fireEvent.press(view.getByLabelText("Dismiss file list"));
  expect(view.getByLabelText("Choose file, a.ts")).toBeVisible();
});

it("reveals a source link once and opens the composer only when a line is tapped", async () => {
  webViewPostedMessages.length = 0;
  const view = await renderWorkspace([], { initialPath: PATH, initialLine: 2, initialColumn: 4 });
  const location = { path: PATH, line: 2, column: 4, side: "new", coordinate: "file" };
  expect(revealedLocations()).toEqual([location]);
  expect(view.queryByTestId("review-line-composer")).toBeNull();

  await tapLine({ coordinate: "file", line: 1, path: PATH, side: "new" });
  expect(view.getByTestId("review-line-composer-anchor")).toHaveTextContent("a.ts · line 1");
  expect(revealedLocations()).toEqual([location]);
});

it("adds a current-thread line comment for the agent from the docked composer without a picker", async () => {
  webViewPostedMessages.length = 0;
  const attached: (readonly CodeReviewComment[])[] = [];
  const view = await renderWorkspace(attached);
  await tapLine({ coordinate: "file", line: 2, path: PATH, side: "new" });

  const composer = view.getByTestId("review-line-composer");
  expect(within(composer).getByTestId("review-line-composer-anchor")).toHaveTextContent(
    "a.ts · line 2",
  );
  for (const removed of ["Send to", "Agent", "Both", "PR"]) {
    expect(within(composer).queryByText(removed)).toBeNull();
  }
  // Without dictation an empty composer offers a disabled Send.
  expect(within(composer).getByTestId("review-comment-send")).toBeDisabled();
  const editor = within(composer).getByTestId("native-editor");
  act(() => {
    editor.props.onChangeText("Split this constant");
    editor.props.onChangeMarkdown("Split this constant");
  });
  const send = within(composer).getByTestId("review-comment-send");
  expect(send).toHaveAccessibleName("Add comment");

  fireEvent.press(send);

  expect(view.queryByTestId("review-line-composer")).toBeNull();
  fireEvent.press(view.getByLabelText("Review comments"));
  expect(view.getByText("Split this constant")).toBeOnTheScreen();
  await act(async () => {
    expect(view.getByLabelText("Attach review")).toBeEnabled();
    fireEvent.press(view.getByLabelText("Attach review"));
    await Promise.resolve();
  });
  expect(attached).toEqual([
    [expect.objectContaining({ body: "Split this constant", line: 2, path: PATH, side: "new" })],
  ]);
});

it("expands into a document: quoted line, top editor and a labelled submit bar", async () => {
  webViewPostedMessages.length = 0;
  const attached: (readonly CodeReviewComment[])[] = [];
  const view = await renderWorkspace(attached);
  await tapLine({
    context: "const b = 2;",
    coordinate: "file",
    line: 2,
    path: PATH,
    side: "new",
  });

  const closeReview = view.getByLabelText("Close code review");
  expect(closeReview).toBeVisible();
  // Collapsed stays the compact pill: no quote and no bottom bar.
  expect(view.queryByTestId("review-line-composer-quote")).toBeNull();
  expect(view.queryByTestId("review-line-composer-actions")).toBeNull();
  const editor = within(view.getByTestId("review-line-composer")).getByTestId("native-editor");

  fireEvent.press(within(view.getByTestId("review-line-composer")).getByLabelText("Expand"));

  expect(closeReview).not.toBeVisible();
  expect(view.queryByLabelText("Review comments")).toBeNull();
  expect(view.queryByLabelText("Changes options")).toBeNull();
  const composer = view.getByTestId("review-line-composer");
  expect(within(composer).getByTestId("review-line-composer-quote")).toHaveTextContent(
    "2const b = 2;",
  );
  expect(within(composer).getByTestId("native-editor")).toBe(editor);
  expect(editor).toHaveStyle({ height: "100%" });
  const actions = within(composer).getByTestId("review-line-composer-actions");
  // Without dictation the bar has no microphone; the submit is labelled text.
  expect(within(actions).queryByLabelText("Voice input")).toBeNull();
  const submit = within(actions).getByTestId("review-comment-send");
  expect(submit).toHaveTextContent("Add comment");
  expect(submit).toBeDisabled();

  act(() => {
    editor.props.onChangeText("Split this constant");
    editor.props.onChangeMarkdown("Split this constant");
  });
  expect(within(actions).getByTestId("review-comment-send")).toBeEnabled();

  fireEvent.press(within(actions).getByTestId("review-comment-send"));

  expect(view.queryByTestId("review-line-composer")).toBeNull();
  expect(closeReview).toBeVisible();
  fireEvent.press(view.getByLabelText("Review comments"));
  await act(async () => {
    expect(view.getByLabelText("Attach review")).toBeEnabled();
    fireEvent.press(view.getByLabelText("Attach review"));
    await Promise.resolve();
  });
  expect(attached).toEqual([
    [
      expect.objectContaining({
        body: "Split this constant",
        context: "const b = 2;",
        line: 2,
        path: PATH,
      }),
    ],
  ]);
});

it("edits a saved note from Review and attaches exactly the edited note", async () => {
  webViewPostedMessages.length = 0;
  const attached: (readonly CodeReviewComment[])[] = [];
  const view = await renderWorkspace(attached);
  const type = (body: string) => {
    const editor = within(view.getByTestId("review-line-composer")).getByTestId("native-editor");
    act(() => {
      editor.props.onChangeText(body);
      editor.props.onChangeMarkdown(body);
    });
  };
  await tapLine({ coordinate: "file", path: PATH, line: 1, side: "old" });
  type("Original");
  fireEvent.press(view.getByLabelText("Add comment"));
  fireEvent.press(view.getByLabelText("Review comments"));
  fireEvent.press(view.getByLabelText("Edit comment on " + PATH + " line 1"));
  expect(revealedLocations()).toEqual([
    expect.objectContaining({ path: PATH, line: 1, side: "old" }),
  ]);
  type("Edited");
  fireEvent.press(view.getByLabelText("Save comment"));
  fireEvent.press(view.getByLabelText("Review comments"));
  expect(view.queryByText("Original")).toBeNull();
  await act(async () => {
    fireEvent.press(view.getByLabelText("Attach review"));
    await Promise.resolve();
  });
  expect(attached[0]).toEqual([
    expect.objectContaining({ body: "Edited", line: 1, path: PATH, side: "old" }),
  ]);
});

it("cancels an edit without changing the saved note and deletes it from Review", async () => {
  webViewPostedMessages.length = 0;
  const view = await renderWorkspace([]);
  await tapLine({ coordinate: "file", line: 2, path: PATH, side: "new" });
  const type = (body: string) => {
    const editor = view.getByTestId("native-editor");
    act(() => {
      editor.props.onChangeText(body);
      editor.props.onChangeMarkdown(body);
    });
  };
  type("Keep the original");
  fireEvent.press(view.getByLabelText("Add comment"));
  fireEvent.press(view.getByLabelText("Review comments"));
  fireEvent.press(view.getByLabelText(`Edit comment on ${PATH} line 2`));
  type("Discard this edit");
  fireEvent.press(view.getByLabelText("Close"));
  fireEvent.press(view.getByLabelText("Review comments"));
  expect(view.getByText("Keep the original")).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText("Delete comment"));
  expect(view.queryByText("Keep the original")).toBeNull();
  expect(view.getByLabelText("Attach review")).toBeDisabled();
});
