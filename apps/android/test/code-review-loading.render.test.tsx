import { act, render } from "@testing-library/react-native";

import { CodeReviewEditor } from "../src/features/review/editor/CodeReviewEditor.native";
import { latestWebViewProps } from "./mocks/ReactNativeWebView";

it("shows loading before the editor is ready and until the selected document arrives", () => {
  const props = {
    document: null,
    loading: true,
    loadError: null,
    files: [],
    workspaceRevision: "workspace",
    selectedPath: "file.ts",
    sidebarOpen: false,
    compact: true,
    wrapLines: false,
    mode: "unified" as const,
    comments: [],
    selectedReference: null,
    revealReference: null,
    commentDraft: "",
    voicePhase: "idle" as const,
    voicePermissionGranted: false,
    voiceRetryAvailable: false,
    voiceError: null,
    onLinePress: jest.fn(),
    onCommentDraftChange: jest.fn(),
    onCommentSelectionChange: jest.fn(),
    onCommentSubmit: jest.fn(),
    onVoicePress: jest.fn(),
    onFileSelect: jest.fn(),
  };
  const view = render(<CodeReviewEditor {...props} />);
  expect(view.getByText("Loading file…")).toBeVisible();
  act(() =>
    latestWebViewProps?.onMessage?.({
      nativeEvent: { data: JSON.stringify({ version: 1, type: "ready" }) },
    }),
  );
  expect(view.getByText("Loading file…")).toBeVisible();
  view.rerender(
    <CodeReviewEditor
      {...props}
      loading={false}
      document={{ path: "file.ts", source: "const value = 1;", patches: [], revision: "loaded" }}
    />,
  );
  expect(view.queryByText("Loading file…")).toBeNull();
  view.rerender(<CodeReviewEditor {...props} loading={false} loadError="File could not be read" />);
  expect(view.getByText("Code preview failed")).toBeVisible();
  expect(view.getByText("File could not be read")).toBeVisible();
  expect(view.queryByText("Loading file…")).toBeNull();
});
