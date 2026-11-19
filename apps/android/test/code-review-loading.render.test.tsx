import { act, fireEvent, render } from "@testing-library/react-native";

import { CodeReviewEditor } from "../src/features/review/editor/CodeReviewEditor.native";
import { latestWebViewProps } from "./mocks/ReactNativeWebView";

it("hands loading to the diff pane once the WebView is ready", () => {
  const props = {
    document: null,
    loading: true,
    loadError: null,
    files: ["file.ts", "next.ts"].map((path) => ({
      path,
      treePath: path,
      status: "modified" as const,
      additions: 1,
      deletions: 0,
    })),
    workspaceRevision: "workspace",
    selectedPath: "file.ts",
    sidebarOpen: true,
    compact: false,
    wrapLines: false,
    mode: "unified" as const,
    comments: [],
    selectedReference: null,
    revealReference: null,
    onLinePress: jest.fn(),
    onFileSelect: jest.fn(),
    onRetryLoad: jest.fn(),
  };
  const view = render(<CodeReviewEditor {...props} />);
  expect(view.getByText("Loading file…")).toBeVisible();
  act(() =>
    latestWebViewProps?.onMessage?.({
      nativeEvent: { data: JSON.stringify({ version: 1, type: "ready" }) },
    }),
  );
  expect(view.queryByText("Loading file…")).toBeNull();
  view.rerender(<CodeReviewEditor {...props} selectedPath="next.ts" />);
  expect(view.queryByText("Loading file…")).toBeNull();
  act(() =>
    latestWebViewProps?.onMessage?.({
      nativeEvent: {
        data: JSON.stringify({ version: 1, type: "fileSelect", path: "file.ts", requestId: 0 }),
      },
    }),
  );
  expect(props.onFileSelect).toHaveBeenCalledWith("file.ts");
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
  fireEvent.press(view.getByRole("button", { name: "Retry" }));
  expect(props.onRetryLoad).toHaveBeenCalledTimes(1);
});
