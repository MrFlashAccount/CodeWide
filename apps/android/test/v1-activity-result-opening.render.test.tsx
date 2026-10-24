import type { RenderBlock } from "@codewide/renderers";
import { fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { Text } from "react-native";
import { CommandItemOutputViewer } from "../src/features/conversation/content/CommandContentViewer";
import { LargeContentViewerContext } from "../src/features/conversation/content/contentViewerContext";
import { CommandExecutionProtocolBlock } from "../src/features/conversation/protocol/CommandOutput";
import { FileChangeProtocolBlock } from "../src/features/conversation/protocol/FileChangeProtocolBlock";
import { ImageProtocolBlock } from "../src/features/conversation/protocol/ImageProtocolBlock";
import { ProtocolBlock } from "../src/features/conversation/protocol/ProtocolBlock";
import { ActivityProtocolListRow } from "../src/features/conversation/protocol/ActivityProtocolListRow";
import { ToolCallProtocolBlock } from "../src/features/conversation/protocol/ToolContent";
import { WebSearchProtocolBlock } from "../src/features/conversation/protocol/WebSearchProtocolBlock";
import { webSearchSummary } from "../src/features/conversation/protocol/webSearchPresentation";
import { Card } from "../src/features/conversation/turns/Card";
import { persistentExpansionStates } from "../src/features/conversation/turns/disclosureState";
import {
  ToolCardPlacementContext,
  TurnTargetContext,
} from "../src/features/conversation/turns/turnContexts";
import { TurnChangesContext } from "../src/rendering/TurnChangesContext";
import { ImagePreviewGroup } from "../src/rendering/ImagePreviewHost";
import {
  ImagePreviewContext,
  type ImagePreviewController,
} from "../src/rendering/imagePreviewController";
import type { LargeContentRouteRequest } from "../src/services/content/contentRouteSession";
import { AppFullscreenOverlayProvider } from "../src/ui/AppFullscreenOverlay";

const mockReadCommandOutput = jest.fn();

// WHY: only the transfer read is replaced; the viewer's reference selection,
// resource lifetime and byte accounting run unchanged.
jest.mock("../src/rendering/command-output-resource", () => ({
  ...jest.requireActual("../src/rendering/command-output-resource"),
  readCommandOutput: (...args: unknown[]) => mockReadCommandOutput(...args),
}));
jest.mock("expo-libghostty", () => jest.requireActual("./mocks/ExpoLibghostty"));

const target = { connectionId: "server", threadId: "thread", turnId: "turn" };
const outputReference = {
  byteLength: 13,
  contentType: "text/plain; charset=utf-8",
  encoding: "utf-8",
  id: "a".repeat(64),
};

beforeEach(() => {
  persistentExpansionStates.clear();
});

it("opens exact command output without offering a competing inline disclosure", () => {
  persistentExpansionStates.set("item:card", true);
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
        <ToolCardPlacementContext.Provider
          value={{
            description: "≈⟡137 · commandExecution",
            kind: "sheet",
            openDetail: jest.fn(),
          }}
        >
          <CommandExecutionProtocolBlock block={block} />
        </ToolCardPlacementContext.Provider>
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
      references: [],
      threadId: "thread",
      command: "pnpm test",
      turnId: "turn",
    },
  ]);
  expect(view.queryByLabelText(/^(Expand|Collapse) pnpm test/)).toBeNull();
  expect(view.queryByText("Input")).toBeNull();
  expect(view.queryByText("Output")).toBeNull();
  expect(view.queryByText("first line")).toBeNull();
});

it("keeps a Card without a semantic viewer inactive", () => {
  const openDetail = jest.fn();
  const view = render(
    <ToolCardPlacementContext.Provider
      value={{ description: "dynamicToolCall", kind: "sheet", openDetail }}
    >
      <Card icon="extension-puzzle-outline" title="Fallback step">
        <Text>Fallback details</Text>
      </Card>
    </ToolCardPlacementContext.Provider>,
  );

  expect(view.queryByText("Fallback details")).toBeNull();
  expect(view.queryByLabelText(/^(Expand|Collapse) Fallback step/)).toBeNull();
  expect(view.queryByLabelText("Open Fallback step")).toBeNull();
  expect(view.getByTestId("activity-step-row")).not.toHaveProp("onPress");
  expect(openDetail).not.toHaveBeenCalled();
});

it("opens unknown protocol output directly in the full-screen content viewer", () => {
  const opened: LargeContentRouteRequest[] = [];
  const block: RenderBlock = {
    body: "raw output",
    collapsible: true,
    content: null,
    durationMs: null,
    key: "unknown:item",
    kind: "unknown",
    raw: { id: "item", payload: { result: "raw output" }, type: "providerExtension" },
    status: "completed",
    title: "Provider extension",
    tone: "neutral",
  };
  const view = render(
    <LargeContentViewerContext.Provider
      value={(request) => {
        opened.push(request);
      }}
    >
      <ActivityProtocolListRow block={block} />
    </LargeContentViewerContext.Provider>,
  );

  fireEvent.press(view.getByRole("button", { name: "Open Provider extension output" }));
  expect(opened).toEqual([
    {
      kind: "inline",
      presentation: "text",
      text: expect.stringContaining("raw output"),
      title: "Unsupported · providerExtension",
    },
  ]);
});

it("opens Web Search through its explicit second-sheet action", () => {
  const openDetail = jest.fn();
  const block: RenderBlock = {
    body: null,
    collapsible: false,
    content: null,
    durationMs: null,
    key: "search:item",
    kind: "webSearch",
    raw: { id: "item", query: "CodeWide", results: [] },
    status: "completed",
    title: "Web search",
    tone: "neutral",
  };
  const view = render(
    <ToolCardPlacementContext.Provider
      value={{ description: "webSearch", kind: "sheet", openDetail }}
    >
      <WebSearchProtocolBlock block={block} />
    </ToolCardPlacementContext.Provider>,
  );

  fireEvent.press(view.getByRole("button", { name: "Open Web search · CodeWide" }));
  expect(openDetail).toHaveBeenCalledTimes(1);
});

it("renders Web Search details as a quiet indexed source list", () => {
  const block: RenderBlock = {
    body: null,
    collapsible: false,
    content: null,
    durationMs: null,
    key: "search:item",
    kind: "webSearch",
    raw: {
      id: "item",
      query: "CodeWide",
      results: [
        {
          snippet: "Agent workspace",
          title: "CodeWide",
          url: "https://www.example.com/full/path",
        },
      ],
    },
    status: "completed",
    title: "Web search",
    tone: "neutral",
  };
  const view = render(
    <ToolCardPlacementContext.Provider value={{ kind: "sheetDetail" }}>
      <WebSearchProtocolBlock block={block} />
    </ToolCardPlacementContext.Provider>,
  );

  expect(webSearchSummary(block)).toEqual({ query: "CodeWide", resultCount: 1 });
  expect(view.getByText("01")).toBeOnTheScreen();
  expect(view.getByText("example.com")).toBeOnTheScreen();
  expect(view.getByText("CodeWide")).toBeOnTheScreen();
  expect(view.getByText("Agent workspace")).toBeOnTheScreen();
  expect(view.getByRole("link", { name: "Open CodeWide from example.com" })).toBeOnTheScreen();
  expect(view.queryByText("https://www.example.com/full/path")).toBeNull();
});

it.each([
  ["started", "inProgress", "Compacting context"],
  ["completed", "completed", "Context compacted"],
] as const)("keeps a %s context-compaction row informational", (phase, status, title) => {
  const openDetail = jest.fn();
  const block: RenderBlock = {
    body: null,
    collapsible: false,
    content: null,
    durationMs: null,
    key: `compaction:${phase}`,
    kind: "contextCompaction",
    raw: { codewideLifecyclePhase: phase, type: "contextCompaction" },
    status,
    title,
    tone: status === "inProgress" ? "info" : "neutral",
  };
  const view = render(
    <ToolCardPlacementContext.Provider
      value={{ description: "contextCompaction", kind: "sheet", openDetail }}
    >
      <ProtocolBlock block={block} />
    </ToolCardPlacementContext.Provider>,
  );

  expect(view.getByText(title)).toBeOnTheScreen();
  expect(view.queryByRole("button", { name: `Open ${title}` })).toBeNull();
  expect(view.getByTestId("activity-step-row")).not.toHaveProp("onPress");
  expect(openDetail).not.toHaveBeenCalled();

  const openActivity = jest.fn();
  const bubble = render(
    <ToolCardPlacementContext.Provider value={{ kind: "bubble", openActivity }}>
      <ProtocolBlock block={block} />
    </ToolCardPlacementContext.Provider>,
  );
  expect(bubble.queryByRole("button", { name: `Open ${title}` })).toBeNull();
  expect(bubble.getByTestId("protocol-card-header")).toBeDisabled();
  expect(openActivity).not.toHaveBeenCalled();
});

it("keeps every generic protocol fallback informational", () => {
  const openDetail = jest.fn();
  const block: RenderBlock = {
    body: "Check the implementation",
    collapsible: false,
    content: null,
    durationMs: null,
    key: "plan:one",
    kind: "plan",
    raw: { id: "plan", text: "Check the implementation", type: "plan" },
    status: "completed",
    title: "Plan",
    tone: "neutral",
  };
  const view = render(
    <ToolCardPlacementContext.Provider value={{ description: "plan", kind: "sheet", openDetail }}>
      <ProtocolBlock block={block} />
    </ToolCardPlacementContext.Provider>,
  );

  expect(view.getByText("Plan")).toBeOnTheScreen();
  expect(view.getByTestId("activity-step-row")).not.toHaveProp("onPress");
  expect(openDetail).not.toHaveBeenCalled();
});

it("opens an image Activity step directly in the shared swipe preview", async () => {
  const openDetail = jest.fn();
  const open = jest.fn();
  const registered = new Map<string, unknown>();
  const imagePreview: ImagePreviewController = {
    createSession: () => <></>,
    open,
    register: (groupId, item) => {
      registered.set(`${groupId}:${item.id}`, item);
      return () => {
        registered.delete(`${groupId}:${item.id}`);
      };
    },
    registerAnnotationHandler: () => () => undefined,
  };
  const first: RenderBlock = {
    body: null,
    collapsible: false,
    content: null,
    durationMs: null,
    key: "image:first",
    kind: "imageGeneration",
    raw: {
      id: "first",
      result: "data:image/png;base64,iVBORw0KGgo=",
    },
    status: "completed",
    title: "First image",
    tone: "success",
  };
  const second: RenderBlock = {
    ...first,
    key: "image:second",
    raw: {
      id: "second",
      result: "data:image/png;base64,iVBORw0KGgp=",
    },
    title: "Second image",
  };
  const view = render(
    <AppFullscreenOverlayProvider>
      <ImagePreviewContext.Provider value={imagePreview}>
        <ImagePreviewGroup id="turn:agent">
          <ToolCardPlacementContext.Provider
            value={{
              description: "imageGeneration",
              kind: "sheet",
              openDetail,
            }}
          >
            <ImageProtocolBlock block={first} />
            <ImageProtocolBlock block={second} />
          </ToolCardPlacementContext.Provider>
        </ImagePreviewGroup>
      </ImagePreviewContext.Provider>
    </AppFullscreenOverlayProvider>,
  );

  await waitFor(() => expect(registered.size).toBe(2));

  fireEvent.press(view.getByLabelText("Open preview for First image"));

  expect(openDetail).not.toHaveBeenCalled();
  expect([...registered.keys()]).toEqual(["turn:agent:image:first", "turn:agent:image:second"]);
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({ groupId: "turn:agent", id: "image:first" }),
    expect.any(Object),
  );
});

it("opens a subagent's command output from the subagent's own thread", () => {
  const opened: LargeContentRouteRequest[] = [];
  const block: RenderBlock = {
    body: "",
    collapsible: true,
    content: null,
    durationMs: null,
    key: "command:item-command",
    kind: "commandExecution",
    raw: {
      aggregatedOutput: "",
      codewideContent: { fields: { "/aggregatedOutput": outputReference }, version: 1 },
      command: "pnpm test",
      id: "item-command",
    },
    status: "completed",
    title: "pnpm test",
    tone: "info",
  };
  // The subagent conversation renders under its parent thread's route.
  const subagent = { ...target, threadId: "thread:agent:a1" };
  const view = render(
    <TurnTargetContext.Provider value={subagent}>
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
    expect.objectContaining({
      itemId: "item-command",
      references: [outputReference],
      threadId: "thread:agent:a1",
      turnId: "turn",
    }),
  ]);
});

it("keeps a tool step without its semantic viewer inactive in a bubble", () => {
  const block: RenderBlock = {
    body: "first line\n",
    collapsible: true,
    content: null,
    durationMs: null,
    key: "command:item-command",
    kind: "commandExecution",
    raw: { command: "pnpm test", id: "item-command" },
    status: "completed",
    title: "pnpm test",
    tone: "info",
  };
  const openActivity = jest.fn();
  const view = render(
    <ToolCardPlacementContext.Provider value={{ kind: "bubble", openActivity }}>
      <CommandExecutionProtocolBlock block={block} />
    </ToolCardPlacementContext.Provider>,
  );

  expect(view.getByText("pnpm test")).toBeOnTheScreen();
  expect(view.queryByLabelText(/^(Expand|Collapse) pnpm test/)).toBeNull();
  expect(view.queryByText("first line")).toBeNull();
  expect(view.queryByText("Output")).toBeNull();
  expect(view.queryByLabelText("Open pnpm test")).toBeNull();
  expect(view.getByTestId("protocol-card-header")).toBeDisabled();
  expect(openActivity).not.toHaveBeenCalled();
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
        references: [reference],
        threadId: "thread",
        command: "pnpm test",
        turnId: "turn",
      }}
      resourceKey="server:thread:item-command"
    />,
  );

  // A shell command always opens in the terminal: a short title, the complete
  // command as its prompt line, the output in Ghostty and the result below.
  expect(await view.findByTestId("terminal-grid")).toHaveTextContent("first\r\nsecond\r\n", {
    normalizeWhitespace: false,
  });
  expect(view.getByRole("header")).toHaveTextContent("Command");
  const prompt = view.getByTestId("command-output-command");
  expect(within(prompt).getByText("❯")).toBeOnTheScreen();
  expect(within(prompt).getByText("pnpm test")).toBeOnTheScreen();
  expect(view.getByText("Finished")).toBeOnTheScreen();
  expect(view.getByText("· exit 0 · 13 B")).toBeOnTheScreen();
  expect(mockReadCommandOutput).toHaveBeenCalledWith(
    expect.objectContaining({ byteLimit: 13, getTransferAccess, references: [reference] }),
    expect.anything(),
  );
});

it("reads the output it was opened with when the thread holds the item no longer", async () => {
  mockReadCommandOutput.mockResolvedValue({ hasMore: false, text: "first\nsecond\n" });
  const getTransferAccess = jest.fn();
  const view = render(
    <CommandItemOutputViewer
      current={null}
      onClose={jest.fn()}
      request={{
        fallbackOutput: "",
        getTransferAccess,
        itemId: "item-command",
        kind: "command",
        references: [outputReference],
        threadId: "thread:agent:a1",
        command: "pnpm test",
        turnId: "turn",
      }}
      resourceKey="server:thread:agent:a1:item-command"
    />,
  );

  expect(await view.findByTestId("terminal-grid")).toHaveTextContent("first\r\nsecond\r\n", {
    normalizeWhitespace: false,
  });
  expect(
    within(view.getByTestId("command-output-command")).getByText("pnpm test"),
  ).toBeOnTheScreen();
  expect(mockReadCommandOutput).toHaveBeenLastCalledWith(
    expect.objectContaining({ getTransferAccess, references: [outputReference] }),
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
