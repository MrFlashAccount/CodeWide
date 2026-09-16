import { act, render } from "@testing-library/react-native";
import { CodeReviewEditor } from "../src/features/review/editor/CodeReviewEditor.native";
import { CODE_REVIEW_BRIDGE_VERSION } from "../src/features/review/editor/editorBridge";
import type { CodeReviewLineReference } from "../src/features/review/comments/reviewComment";
import { latestWebViewProps, webViewPostedMessages } from "./mocks/ReactNativeWebView";

const firstLine: CodeReviewLineReference = { path: "example.ts", line: 7, side: "new" };
const secondLine: CodeReviewLineReference = { path: "example.ts", line: 12, side: "new" };

function documentRequestId(): number {
  for (const serialized of webViewPostedMessages) {
    const message: unknown = JSON.parse(serialized);
    if (
      message !== null &&
      typeof message === "object" &&
      "command" in message &&
      message.command === "document" &&
      "payload" in message &&
      message.payload !== null &&
      typeof message.payload === "object" &&
      "requestId" in message.payload &&
      typeof message.payload.requestId === "number"
    )
      return message.payload.requestId;
  }
  throw new Error("Editor did not publish its document request");
}

it("routes voice and draft events only to the selected review input, including delayed bridge events", () => {
  webViewPostedMessages.length = 0;
  const onVoicePress = jest.fn();
  const onCommentDraftChange = jest.fn();
  const onCommentSelectionChange = jest.fn();
  const props = {
    document: null,
    loading: false,
    loadError: null,
    files: [],
    workspaceRevision: "test-workspace",
    selectedPath: firstLine.path,
    sidebarOpen: false,
    compact: false,
    wrapLines: false,
    mode: "source" as const,
    comments: [],
    revealReference: null,
    commentDraft: "",
    voicePhase: "idle" as const,
    voicePermissionGranted: true,
    voiceRetryAvailable: false,
    voiceError: null,
    onLinePress: jest.fn(),
    onCommentDraftChange,
    onCommentSelectionChange,
    onCommentSubmit: jest.fn(),
    onVoicePress,
    onFileSelect: jest.fn(),
  };
  const view = render(<CodeReviewEditor {...props} selectedReference={firstLine} />);
  act(() =>
    latestWebViewProps?.onMessage?.({
      nativeEvent: {
        data: JSON.stringify({ version: CODE_REVIEW_BRIDGE_VERSION, sequence: 1, type: "ready" }),
      },
    }),
  );
  const requestId = documentRequestId();
  let sequence = 1;
  function deliver(type: "voiceAction" | "draftChanged", reference: unknown) {
    sequence += 1;
    act(() =>
      latestWebViewProps?.onMessage?.({
        nativeEvent: {
          data: JSON.stringify({
            version: CODE_REVIEW_BRIDGE_VERSION,
            sequence,
            type,
            requestId,
            reference,
            draft: "dictated review",
            selectionStart: 0,
            selectionEnd: 0,
          }),
        },
      }),
    );
  }
  deliver("voiceAction", firstLine);
  expect(onVoicePress).toHaveBeenCalledTimes(1);
  expect(onVoicePress).toHaveBeenLastCalledWith("dictated review", { start: 0, end: 0 });
  view.rerender(<CodeReviewEditor {...props} selectedReference={secondLine} />);
  deliver("voiceAction", firstLine);
  deliver("draftChanged", firstLine);
  deliver("voiceAction", undefined);
  deliver("draftChanged", null);
  expect(onVoicePress).toHaveBeenCalledTimes(1);
  expect(onCommentDraftChange).not.toHaveBeenCalled();
  expect(onCommentSelectionChange).not.toHaveBeenCalled();
  deliver("voiceAction", secondLine);
  deliver("draftChanged", secondLine);
  expect(onVoicePress).toHaveBeenCalledTimes(2);
  expect(onCommentDraftChange).toHaveBeenCalledTimes(1);
  expect(onCommentDraftChange).toHaveBeenLastCalledWith("dictated review");
  view.rerender(<CodeReviewEditor {...props} selectedReference={null} />);
  deliver("voiceAction", secondLine);
  expect(onVoicePress).toHaveBeenCalledTimes(2);
});
