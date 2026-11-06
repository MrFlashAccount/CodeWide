import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import type { EnrichedMarkdownTextInputProps } from "react-native-enriched-markdown";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { CodeReviewComment } from "../src/features/review/comments/reviewComment";
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

const PATH = "/repo/src/a.ts";

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

it("adds a current-thread line comment for the agent from the docked composer without a picker", async () => {
  webViewPostedMessages.length = 0;
  const attached: (readonly CodeReviewComment[])[] = [];
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

  await act(async () => {
    latestWebViewProps?.onMessage?.({
      nativeEvent: {
        data: JSON.stringify({
          reference: { coordinate: "file", line: 2, path: PATH, side: "new" },
          requestId: documentRequestId(),
          type: "lineTap",
          version: 1,
        }),
      },
    });
    await Promise.resolve();
  });

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
  expect(view.getByText("Split this constant")).toBeOnTheScreen();
  await act(async () => {
    fireEvent.press(view.getByLabelText("Attach review"));
    await Promise.resolve();
  });
  expect(attached).toEqual([
    [expect.objectContaining({ body: "Split this constant", line: 2, path: PATH, side: "new" })],
  ]);
});
