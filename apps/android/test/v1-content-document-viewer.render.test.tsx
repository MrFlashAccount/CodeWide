import type { RenderBlock, RenderContentReference } from "@codewide/renderers";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { useState, type ReactNode } from "react";

import { ContentDocumentViewer } from "../src/features/conversation/content/ContentDocumentViewer";
import { LargeContentViewerContext } from "../src/features/conversation/content/contentViewerContext";
import { ProtocolBlock } from "../src/features/conversation/protocol/ProtocolBlock";
import { ActivityDetailSheet } from "../src/features/conversation/turns/ActivityDetailSheet";
import { ToolCardPlacementContext } from "../src/features/conversation/turns/turnContexts";
import type { TransferAccess } from "../src/data/private-transfer";
import type { LargeContentRouteRequest } from "../src/services/content/contentRouteSession";

// WHY: Node cannot mount the native bottom-sheet window. Keep the real Activity header and list.
jest.mock("@expo/ui/community/bottom-sheet", () => {
  const { ScrollView, View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    BottomSheet: ({ children }: { readonly children: ReactNode }) => <View>{children}</View>,
    BottomSheetScrollView: ScrollView,
    BottomSheetView: View,
  };
});

type ChunkRequest = { readonly limit: number | undefined; readonly offset: number | undefined };
type ChunkResult = { readonly nextOffset: number; readonly text: string };

const mockReadPrivateAssetText = jest.fn<
  Promise<ChunkResult>,
  [unknown, unknown, ChunkRequest]
>();

// WHY: only the Companion read is replaced; the reader's chunk joining, paging and
// presentation run unchanged.
jest.mock("../src/data/private-transfer", () => ({
  ...jest.requireActual("../src/data/private-transfer"),
  readPrivateAssetText: async (source: unknown, access: unknown, options: ChunkRequest) =>
    mockReadPrivateAssetText(source, access, options),
}));

/** The viewer's connection; the replaced read never asks it for access. */
async function getTransferAccess(): Promise<TransferAccess> {
  throw new Error("The Companion read is replaced in this test");
}

function reference(byteLength: number): RenderContentReference {
  return {
    byteLength,
    contentType: "text/plain; charset=utf-8",
    encoding: "utf-8",
    id: "c".repeat(64),
  };
}

/** A Claude `Read` call whose 20 KB result the Companion moved out of line. */
function readBlock(result: RenderContentReference): RenderBlock {
  return {
    body: null,
    collapsible: true,
    content: { fields: { "/contentItems/0/text": result }, whole: null },
    durationMs: null,
    key: "tool:read",
    kind: "dynamicToolCall",
    raw: {
      arguments: { file_path: "/repo/src/large.ts" },
      contentItems: [{ text: "line one\n…", type: "text" }],
      id: "read",
      tool: "Read",
    },
    status: "completed",
    title: "Read",
    tone: "success",
  };
}

/**
 * Activity rows as the sheet places them, opening the full-screen viewer in
 * their place. (The sheet itself is rendered separately: its native window
 * host does not take test presses.)
 */
function ActivityWithViewer({ blocks }: { readonly blocks: readonly RenderBlock[] }) {
  const [opened, setOpened] = useState<LargeContentRouteRequest | null>(null);
  if (opened?.kind === "document") {
    return (
      <ContentDocumentViewer
        onClose={() => {
          setOpened(null);
        }}
        request={opened}
      />
    );
  }
  return (
    <LargeContentViewerContext.Provider value={setOpened}>
      {blocks.map((block) => (
        <ToolCardPlacementContext.Provider
          key={block.key}
          value={{ description: block.title, kind: "sheet", openDetail: () => undefined }}
        >
          <ProtocolBlock block={block} getTransferAccess={getTransferAccess} />
        </ToolCardPlacementContext.Provider>
      ))}
    </LargeContentViewerContext.Provider>
  );
}

function deferred(): {
  readonly promise: Promise<ChunkResult>;
  readonly reject: (error: Error) => void;
  readonly resolve: (value: ChunkResult) => void;
} {
  let resolve: (value: ChunkResult) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<ChunkResult>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function requestedOffsets(): readonly (number | undefined)[] {
  return mockReadPrivateAssetText.mock.calls.map(([, , options]) => options.offset);
}

const SIZE_TEXT = /\b\d[\d,.]*\s?(?:B|KB|MB|bytes)\b/u;

beforeEach(() => {
  mockReadPrivateAssetText.mockReset();
});

it("lists a referenced result as one Activity row without a separate content button", () => {
  const view = render(
    <LargeContentViewerContext.Provider value={jest.fn()}>
      <ActivityDetailSheet
        blocks={[readBlock(reference(20_480))]}
        getTransferAccess={getTransferAccess}
        onClose={() => undefined}
        turnKey="turn-1"
        turnStatus="completed"
        visible
      />
    </LargeContentViewerContext.Provider>,
  );

  expect(view.getAllByTestId("activity-step-row")).toHaveLength(1);
  expect(view.getByLabelText("Open Read output")).toBeOnTheScreen();
  expect(view.queryByText(/Open full content/u)).toBeNull();
  expect(view.queryByText(SIZE_TEXT)).toBeNull();
});

it("opens a referenced result's first chunk when its Activity row is pressed", async () => {
  mockReadPrivateAssetText.mockResolvedValueOnce({ nextOffset: 9, text: "line one\n" });
  const view = render(<ActivityWithViewer blocks={[readBlock(reference(20_480))]} />);

  fireEvent.press(view.getByLabelText("Open Read output"));

  expect(await view.findByText("line one")).toBeOnTheScreen();
  expect(view.getByText("contentItems › 0 › text")).toBeOnTheScreen();
  expect(requestedOffsets()).toEqual([0]);
  expect(mockReadPrivateAssetText.mock.calls[0]?.[2].limit).toBe(64 * 1024);
  expect(view.queryByText(SIZE_TEXT)).toBeNull();
  expect(view.queryByRole("button", { name: /output page/u })).toBeNull();
});

it("appends the next chunk at the end of the list without a visible boundary", async () => {
  const second = deferred();
  mockReadPrivateAssetText
    .mockResolvedValueOnce({ nextOffset: 16, text: "line one\nline tw" })
    .mockReturnValueOnce(second.promise);
  const view = render(<ActivityWithViewer blocks={[readBlock(reference(31))]} />);
  fireEvent.press(view.getByLabelText("Open Read output"));
  expect(await view.findByText("line tw")).toBeOnTheScreen();

  fireEvent(view.getByTestId("content-document-list"), "endReached", { distanceFromEnd: 0 });

  // The continued line shimmers in place while its next chunk loads.
  expect(view.getByTestId("content-document-loading-row")).toHaveTextContent("line tw");
  await act(async () => {
    second.resolve({ nextOffset: 31, text: "o\nline three\n" });
    await second.promise;
  });

  expect(view.getByText("line two\nline three")).toBeOnTheScreen();
  expect(view.queryByText("line tw")).toBeNull();
  expect(view.queryByTestId("content-document-loading-row")).toBeNull();
  expect(requestedOffsets()).toEqual([0, 16]);
});

it("continues at the Companion's character-aligned offset so a multibyte character stays whole", async () => {
  // The first range ends inside "é"; the Companion stops before it and names
  // where the next chunk starts.
  mockReadPrivateAssetText
    .mockResolvedValueOnce({ nextOffset: 10, text: "naïve caf" })
    .mockResolvedValueOnce({ nextOffset: 18, text: "é ☕\n" });
  const view = render(<ActivityWithViewer blocks={[readBlock(reference(18))]} />);
  fireEvent.press(view.getByLabelText("Open Read output"));
  expect(await view.findByText("naïve caf")).toBeOnTheScreen();

  fireEvent(view.getByTestId("content-document-list"), "endReached", { distanceFromEnd: 0 });

  expect(await view.findByText("naïve café ☕")).toBeOnTheScreen();
  expect(view.queryByText(/�/u)).toBeNull();
  expect(requestedOffsets()).toEqual([0, 10]);
});

it("shows a failed chunk's error at the tail and retries the same chunk", async () => {
  mockReadPrivateAssetText
    .mockResolvedValueOnce({ nextOffset: 6, text: "first\n" })
    .mockRejectedValueOnce(new Error("Private content unavailable (503)"))
    .mockResolvedValueOnce({ nextOffset: 13, text: "second\n" });
  const view = render(<ActivityWithViewer blocks={[readBlock(reference(13))]} />);
  fireEvent.press(view.getByLabelText("Open Read output"));
  expect(await view.findByText("first")).toBeOnTheScreen();

  fireEvent(view.getByTestId("content-document-list"), "endReached", { distanceFromEnd: 0 });

  expect(await view.findByText("Private content unavailable (503)")).toBeOnTheScreen();
  expect(view.getByText("first")).toBeOnTheScreen();

  fireEvent.press(view.getByRole("button", { name: "Retry" }));

  expect(await view.findByText("second")).toBeOnTheScreen();
  expect(view.queryByText("Private content unavailable (503)")).toBeNull();
  expect(requestedOffsets()).toEqual([0, 6, 6]);
});

it("reads nothing more once the last chunk arrived", async () => {
  mockReadPrivateAssetText.mockResolvedValueOnce({ nextOffset: 5, text: "done\n" });
  const view = render(<ActivityWithViewer blocks={[readBlock(reference(5))]} />);
  fireEvent.press(view.getByLabelText("Open Read output"));
  expect(await view.findByText("done")).toBeOnTheScreen();

  fireEvent(view.getByTestId("content-document-list"), "endReached", { distanceFromEnd: 0 });

  await waitFor(() => {
    expect(view.getByLabelText("Copy")).toBeOnTheScreen();
  });
  expect(requestedOffsets()).toEqual([0]);
});

it("opens a shortened user message in the viewer from its bubble", () => {
  const opened: LargeContentRouteRequest[] = [];
  const text = reference(40_000);
  const block: RenderBlock = {
    body: null,
    collapsible: false,
    content: { fields: { "/content/0/text": text }, whole: null },
    durationMs: null,
    key: "user:item",
    kind: "userMessage",
    raw: { content: [{ text: "A long prompt…", type: "text" }], id: "item" },
    status: null,
    title: "",
    tone: "neutral",
  };
  const view = render(
    <LargeContentViewerContext.Provider
      value={(request) => {
        opened.push(request);
      }}
    >
      <ProtocolBlock block={block} getTransferAccess={getTransferAccess} />
    </LargeContentViewerContext.Provider>,
  );

  expect(view.queryByText(/Open full content/u)).toBeNull();
  fireEvent.press(view.getByRole("button", { name: "Open full message" }));

  expect(opened).toEqual([
    {
      getTransferAccess,
      kind: "document",
      parts: [
        {
          kind: "reference",
          label: "content › 0 › text",
          presentation: "text",
          reference: text,
        },
      ],
      title: "Message",
    },
  ]);
});
