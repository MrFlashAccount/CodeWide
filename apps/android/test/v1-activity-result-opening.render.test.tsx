import type { RenderBlock } from "@codewide/renderers";
import { fireEvent, render } from "@testing-library/react-native";
import { LargeContentViewerContext } from "../src/features/conversation/content/contentViewerContext";
import { CommandExecutionProtocolBlock } from "../src/features/conversation/protocol/CommandOutput";
import { FileChangeProtocolBlock } from "../src/features/conversation/protocol/FileChangeProtocolBlock";
import { ToolCallProtocolBlock } from "../src/features/conversation/protocol/ToolContent";
import { TurnTargetContext } from "../src/features/conversation/turns/turnContexts";
import { TurnChangesContext } from "../src/rendering/TurnChangesContext";
import type { LargeContentRouteRequest } from "../src/services/content/contentRouteSession";

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
