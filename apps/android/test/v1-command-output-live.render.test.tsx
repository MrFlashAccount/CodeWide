import type { RenderBlock } from "@codewide/renderers";
import type { CommandOutputReference } from "@codewide/sync-client";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { CommandItemOutputViewer } from "../src/features/conversation/content/CommandContentViewer";
import { LargeContentViewerContext } from "../src/features/conversation/content/contentViewerContext";
import { CommandExecutionProtocolBlock } from "../src/features/conversation/protocol/CommandOutput";
import {
  BackgroundTaskContext,
  ToolCardPlacementContext,
  TurnTargetContext,
} from "../src/features/conversation/turns/turnContexts";
import { resetFollowedCommandOutputs } from "../src/rendering/commandOutputFollow";
import type {
  CommandContentRouteRequest,
  LargeContentRouteRequest,
} from "../src/services/content/contentRouteSession";

const segmentTexts = new Map<string, string>();
const mockReadCommandOutput = jest.fn(
  async (request: { readonly references: readonly CommandOutputReference[] }) => ({
    hasMore: false,
    text: request.references.map((reference) => segmentTexts.get(reference.id) ?? "").join(""),
  }),
);

// WHY: only the private-content transfer is replaced; the viewer's live item
// projection, follow prefix, resource revisions and terminal writes run unchanged.
jest.mock("../src/rendering/command-output-resource", () => ({
  ...jest.requireActual("../src/rendering/command-output-resource"),
  readCommandOutput: async (
    ...args: [{ readonly references: readonly CommandOutputReference[] }]
  ) => mockReadCommandOutput(...args),
}));
jest.mock("expo-libghostty", () => jest.requireActual("./mocks/ExpoLibghostty"));

type CommandItem = NonNullable<Parameters<typeof CommandItemOutputViewer>[0]["current"]>;

function segment(name: string, text: string): CommandOutputReference {
  const id = name.repeat(64).slice(0, 64);
  segmentTexts.set(id, text);
  return {
    byteLength: text.length,
    contentType: "text/plain; charset=utf-8",
    encoding: "utf-8",
    id,
  };
}

/** A Codex command item as the live reducer leaves it after output deltas. */
function runningItem(deltas: readonly CommandOutputReference[]): CommandItem {
  // WHY: `codewideOutputDeltas` is the Companion's wire extension that the
  // generated App Server item type does not declare; the viewer reads it at runtime.
  return {
    aggregatedOutput: "",
    codewideOutputDeltas: deltas,
    command: "pnpm build",
    commandActions: [],
    cwd: "/workspace",
    durationMs: null,
    exitCode: null,
    id: "item-command",
    processId: null,
    source: "agent",
    status: "inProgress",
    type: "commandExecution",
  } as CommandItem;
}

const request: CommandContentRouteRequest = {
  command: "pnpm build",
  fallbackOutput: "",
  getTransferAccess: jest.fn(),
  itemId: "item-command",
  kind: "command",
  references: [],
  threadId: "thread",
  turnId: "turn",
};

beforeEach(() => {
  segmentTexts.clear();
  mockReadCommandOutput.mockClear();
  mockReadCommandOutput.mockImplementation(async ({ references }) => ({
    hasMore: false,
    text: references.map((reference) => segmentTexts.get(reference.id) ?? "").join(""),
  }));
  resetFollowedCommandOutputs();
});

function viewer(current: CommandItem) {
  return (
    <CommandItemOutputViewer
      current={current}
      onClose={jest.fn()}
      request={request}
      resourceKey="server:thread:item-command"
    />
  );
}

it("shows each new output of an open running command without reopening, then settles", async () => {
  const first = segment("a", "compiling\n");
  const second = segment("b", "linking\n");
  const third = segment("c", "bundling\n");
  const view = render(viewer(runningItem([first])));
  const terminal = await view.findByTestId("terminal-grid");
  await waitFor(() => {
    expect(terminal).toHaveTextContent("compiling\r\n", { normalizeWhitespace: false });
  });
  expect(view.getByText("Running")).toBeOnTheScreen();

  view.rerender(viewer(runningItem([first, second])));
  await waitFor(() => {
    expect(view.getByTestId("terminal-grid")).toHaveTextContent("compiling\r\nlinking\r\n", {
      normalizeWhitespace: false,
    });
  });
  view.rerender(viewer(runningItem([first, second, third])));
  await waitFor(() => {
    expect(view.getByTestId("terminal-grid")).toHaveTextContent(
      "compiling\r\nlinking\r\nbundling\r\n",
      { normalizeWhitespace: false },
    );
  });
  // Every segment was read once: an update reads only the new output.
  expect(mockReadCommandOutput.mock.calls.map(([call]) => call.references)).toEqual([
    [first],
    [second],
    [third],
  ]);

  const whole = segment("d", "compiling\nlinking\nbundling\ndone\n");
  view.rerender(
    // WHY: `codewideContent` is the Companion's wire extension, absent from the
    // generated item type; the completed upsert replaces the delta list with it.
    viewer({
      ...runningItem([]),
      codewideContent: { fields: { "/aggregatedOutput": whole }, version: 1 },
      codewideOutputDeltas: undefined,
      durationMs: 40,
      exitCode: 0,
      status: "completed",
    } as CommandItem),
  );
  await waitFor(() => {
    expect(view.getByText("Finished")).toBeOnTheScreen();
  });
  await waitFor(() => {
    expect(view.getByTestId("terminal-grid")).toHaveTextContent(
      "compiling\r\nlinking\r\nbundling\r\ndone\r\n",
      { normalizeWhitespace: false },
    );
  });
  expect(view.getByText(`· exit 0 · ${String(whole.byteLength)} B`)).toBeOnTheScreen();
});

it("shows output already read while newer output keeps arriving faster than it loads", async () => {
  const first = segment("a", "compiling\n");
  const second = segment("b", "linking\n");
  const third = segment("c", "bundling\n");
  const releases = new Map<string, () => void>();
  const loads = new Map<string, Promise<void>>();
  const loaded = (id: string): Promise<void> => {
    const existing = loads.get(id);
    if (existing !== undefined) {
      return existing;
    }
    const load = new Promise<void>((resolve) => {
      releases.set(id, resolve);
    });
    loads.set(id, load);
    return load;
  };
  // Each segment loads only when released, like a slow transfer; one request
  // for several segments waits for all of them.
  mockReadCommandOutput.mockImplementation(async ({ references }) => {
    await Promise.all(references.map(async (reference) => loaded(reference.id)));
    return {
      hasMore: false,
      text: references.map((reference) => segmentTexts.get(reference.id) ?? "").join(""),
    };
  });
  const view = render(viewer(runningItem([first])));
  await waitFor(() => {
    expect(releases.has(first.id)).toBe(true);
  });
  view.rerender(viewer(runningItem([first, second])));
  await act(async () => {
    releases.get(first.id)?.();
    await Promise.resolve();
  });
  // A newer segment arrives before the second one has loaded.
  view.rerender(viewer(runningItem([first, second, third])));

  await waitFor(() => {
    expect(view.getByTestId("terminal-grid")).toHaveTextContent("compiling\r\n", {
      normalizeWhitespace: false,
    });
  });
  // The second segment is still loading; release it, then the third.
  expect(view.getByTestId("terminal-grid")).not.toHaveTextContent(/linking/u);
  await waitFor(() => {
    expect(releases.has(second.id)).toBe(true);
  });
  await act(async () => {
    releases.get(second.id)?.();
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(releases.has(third.id)).toBe(true);
  });
  await act(async () => {
    releases.get(third.id)?.();
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(view.getByTestId("terminal-grid")).toHaveTextContent(
      "compiling\r\nlinking\r\nbundling\r\n",
      { normalizeWhitespace: false },
    );
  });
});

it("keeps a long live output bounded to its newest lines", async () => {
  const line = `${"x".repeat(1023)}\n`;
  const block = line.repeat(512);
  const segments = Array.from({ length: 4 }, (_, index) => segment(String(index), block));
  const view = render(viewer(runningItem(segments.slice(0, 1))));
  await view.findByTestId("terminal-grid");
  for (let count = 2; count <= segments.length; count += 1) {
    view.rerender(viewer(runningItem(segments.slice(0, count))));
    await act(async () => {
      await Promise.resolve();
    });
  }
  await waitFor(() => {
    expect(mockReadCommandOutput).toHaveBeenCalledTimes(segments.length);
  });
  await waitFor(() => {
    expect(view.getByTestId("terminal-grid")).toHaveTextContent(/Earlier output is not shown\./u);
  });
});

const backgroundBlock: RenderBlock = {
  body: "Command running in background with ID: b1.",
  collapsible: true,
  content: null,
  durationMs: null,
  key: "command:item-bg",
  kind: "commandExecution",
  raw: { codewideBackgroundTaskId: "b1", command: "pnpm dev", id: "item-bg" },
  status: "completed",
  title: "pnpm dev",
  tone: "info",
};

function backgroundRow(
  openTask: (task: { readonly name: string; readonly taskId: string }) => Promise<void>,
  opened: LargeContentRouteRequest[],
) {
  return (
    <TurnTargetContext.Provider
      value={{ connectionId: "server", threadId: "thread", turnId: "turn" }}
    >
      <LargeContentViewerContext.Provider
        value={(next) => {
          opened.push(next);
        }}
      >
        <BackgroundTaskContext.Provider value={openTask}>
          <ToolCardPlacementContext.Provider value={{ kind: "bubble", openActivity: null }}>
            <CommandExecutionProtocolBlock block={backgroundBlock} />
          </ToolCardPlacementContext.Provider>
        </BackgroundTaskContext.Provider>
      </LargeContentViewerContext.Provider>
    </TurnTargetContext.Provider>
  );
}

it("opens a Claude background command's followed task output, not its launch result", async () => {
  const openTask = jest.fn(async () => undefined);
  const opened: LargeContentRouteRequest[] = [];
  const view = render(backgroundRow(openTask, opened));

  fireEvent.press(view.getByTestId("protocol-card-header"));

  await waitFor(() => {
    expect(openTask).toHaveBeenCalledWith({ name: "Background command", taskId: "b1" });
  });
  expect(opened).toEqual([]);
});

it("falls back to the command's own output when its task output cannot be read", async () => {
  const openTask = jest.fn(async () => {
    throw new Error("Task output is unavailable");
  });
  const opened: LargeContentRouteRequest[] = [];
  const view = render(backgroundRow(openTask, opened));

  fireEvent.press(view.getByTestId("protocol-card-header"));

  await waitFor(() => {
    expect(opened).toEqual([expect.objectContaining({ itemId: "item-bg", kind: "command" })]);
  });
});
