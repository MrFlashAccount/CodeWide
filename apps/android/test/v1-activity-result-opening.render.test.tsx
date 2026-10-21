import type { RenderBlock } from "@codewide/renderers";
import { fireEvent, render } from "@testing-library/react-native";
import { CommandItemOutputViewer } from "../src/features/conversation/content/CommandContentViewer";
import { LargeContentViewerContext } from "../src/features/conversation/content/contentViewerContext";
import { CommandExecutionProtocolBlock } from "../src/features/conversation/protocol/CommandOutput";
import { FileChangeProtocolBlock } from "../src/features/conversation/protocol/FileChangeProtocolBlock";
import { ToolCallProtocolBlock } from "../src/features/conversation/protocol/ToolContent";
import { TurnTargetContext } from "../src/features/conversation/turns/turnContexts";
import { TurnChangesContext } from "../src/rendering/TurnChangesContext";
import type { LargeContentRouteRequest } from "../src/services/content/contentRouteSession";

const mockReadCommandOutput = jest.fn();

// WHY: only the transfer read is replaced; the viewer's reference selection,
// resource lifetime and byte accounting run unchanged.
jest.mock("../src/rendering/command-output-resource", () => ({
  ...jest.requireActual("../src/rendering/command-output-resource"),
  readCommandOutput: (...args: unknown[]) => mockReadCommandOutput(...args),
}));

const target = { connectionId: "server", threadId: "thread", turnId: "turn" };

it("opens the exact command output without using its disclosure action", () => {
  const opened: LargeContentRouteRequest[] = [];
  const block: RenderBlock = {
    body: "first line\n",
    collapsible: true,
    content: null,
    durationMs: null,
    key: "command:item-command",
    kind: "commandExecution",
    raw: { command: "pnpm test", id: "item-command" },
    status: "inProgress",
    title: "pnpm test",
    tone: "info",
  };
  const view = render(
    <TurnTargetContext.Provider value={target}>
      <LargeContentViewerContext.Provider
        value={(request) => {
          opened.push(request);
        }}
      >
        <CommandExecutionProtocolBlock block={block} />
      </LargeContentViewerContext.Provider>
    </TurnTargetContext.Provider>,
  );

  fireEvent.press(view.getByLabelText("Open output for pnpm test"));
  expect(opened).toEqual([
    {
      fallbackOutput: "first line\n",
      getTransferAccess: null,
      itemId: "item-command",
      kind: "command",
      title: "pnpm test",
      turnId: "turn",
    },
  ]);
  expect(view.getByLabelText("Expand pnpm test")).toBeOnTheScreen();
});

it("opens only the patches owned by the selected file-change call", () => {
  const present = jest.fn();
  const block: RenderBlock = {
    body: null,
    collapsible: true,
    content: null,
    durationMs: null,
    key: "change:item-change",
    kind: "fileChange",
    raw: {
      changes: [
        {
          diff: "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new\n",
          kind: { type: "update" },
          path: "file.ts",
        },
      ],
      id: "item-change",
    },
    status: "completed",
    title: "File changes",
    tone: "success",
  };
  const view = render(
    <TurnTargetContext.Provider value={target}>
      <TurnChangesContext.Provider value={present}>
        <FileChangeProtocolBlock block={block} />
      </TurnChangesContext.Provider>
    </TurnTargetContext.Provider>,
  );

  fireEvent.press(view.getByLabelText("Open these file changes"));
  expect(present).toHaveBeenCalledWith(
    target,
    [
      {
        additions: 1,
        deletions: 1,
        itemId: "item-change",
        kind: "update",
        patch: "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new\n",
        path: "file.ts",
      },
    ],
    "item",
  );
});

it.each(["failed", "declined", "inProgress"])(
  "does not open the proposal of a %s file-change call as recorded patches",
  (status) => {
    const present = jest.fn();
    const block: RenderBlock = {
      body: null,
      collapsible: true,
      content: null,
      durationMs: null,
      key: "change:item-change",
      kind: "fileChange",
      raw: {
        changes: [{ diff: "-old\n+new\n", kind: { type: "update" }, path: "file.rs" }],
        id: "item-change",
      },
      status,
      title: "File changes",
      tone: "error",
    };
    const view = render(
      <TurnTargetContext.Provider value={target}>
        <TurnChangesContext.Provider value={present}>
          <FileChangeProtocolBlock block={block} />
        </TurnChangesContext.Provider>
      </TurnTargetContext.Provider>,
    );

    expect(view.queryByLabelText("Open these file changes")).toBeNull();
    expect(view.getByText("File changes · 1")).toBeOnTheScreen();
    expect(present).not.toHaveBeenCalled();
  },
);

it("shows command output that the Companion moved into private content", async () => {
  mockReadCommandOutput.mockResolvedValue({ hasMore: false, text: "first\nsecond\n" });
  const getTransferAccess = jest.fn();
  const reference = {
    byteLength: 13,
    contentType: "text/plain; charset=utf-8",
    encoding: "utf-8",
    id: "a".repeat(64),
  };
  const externalized = {
    aggregatedOutput: "",
    codewideContent: { fields: { "/aggregatedOutput": reference }, version: 1 },
    command: "pnpm test",
    commandActions: [],
    cwd: "/workspace",
    durationMs: 10,
    exitCode: 0,
    id: "item-command",
    processId: null,
    source: "agent" as const,
    status: "completed" as const,
    type: "commandExecution" as const,
  };
  const view = render(
    <CommandItemOutputViewer
      current={externalized}
      onClose={jest.fn()}
      request={{
        fallbackOutput: "",
        getTransferAccess,
        itemId: "item-command",
        kind: "command",
        title: "pnpm test",
        turnId: "turn",
      }}
      resourceKey="server:thread:item-command"
    />,
  );

  expect(await view.findByText("1–13 / 13 bytes")).toBeOnTheScreen();
  expect(mockReadCommandOutput).toHaveBeenCalledWith(
    expect.objectContaining({ byteLimit: 13, getTransferAccess, references: [reference] }),
    expect.anything(),
  );
});

it("opens an unclassified tool result in the generic content viewer", () => {
  const opened: LargeContentRouteRequest[] = [];
  const block: RenderBlock = {
    body: null,
    collapsible: true,
    content: null,
    durationMs: null,
    key: "tool:item-tool",
    kind: "dynamicToolCall",
    raw: { arguments: { value: 1 }, contentItems: [{ text: "result", type: "text" }] },
    status: "completed",
    title: "Custom tool",
    tone: "success",
  };
  const view = render(
    <LargeContentViewerContext.Provider
      value={(request) => {
        opened.push(request);
      }}
    >
      <ToolCallProtocolBlock block={block} />
    </LargeContentViewerContext.Provider>,
  );

  fireEvent.press(view.getByLabelText("Open Custom tool output"));
  expect(opened).toHaveLength(1);
  expect(opened[0]).toMatchObject({ kind: "inline", presentation: "text", title: "Custom tool" });
  expect(opened[0]?.kind === "inline" ? opened[0].text : "").toContain('"contentItems"');
});
