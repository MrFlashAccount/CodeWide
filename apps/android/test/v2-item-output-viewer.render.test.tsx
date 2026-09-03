import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  ItemOutputViewer,
  type ItemOutputPage,
} from "../src/v2/features/conversation/ItemOutputViewer";
import { ItemOutputResource } from "../src/v2/features/conversation/itemOutputResource";
import { savedServerId, threadId } from "../src/v2/domain/ids";

const FIRST_PAGE: ItemOutputPage = {
  content: "first page\n",
  format: "terminal",
  next: "opaque-next",
  totalBytes: "23",
};

describe("V2 item output viewer", () => {
  it("loads the next bounded page with the exact turn and item owner", async () => {
    const loadPage = jest.fn(async () => finalPage());
    renderViewer({ copyText: jest.fn(async () => undefined), loadPage });

    await act(async () => fireEvent.press(screen.getByLabelText("Load more output")));

    expect(loadPage).toHaveBeenCalledWith("turn-a", "item-a", "opaque-next");
    expect(screen.getByText("first page\nsecond page")).toBeTruthy();
    expect(screen.queryByLabelText("Load more output")).toBeNull();
  });

  it("materializes every remaining page before copying", async () => {
    const copyText = jest.fn(async () => undefined);
    const loadPage = jest.fn(async () => finalPage());
    renderViewer({ copyText, loadPage });

    await act(async () => fireEvent.press(screen.getByLabelText("Copy complete output")));

    expect(copyText).toHaveBeenCalledWith("first page\nsecond page");
    expect(screen.getByText("Copied")).toBeTruthy();
  });

  it("keeps loaded output and offers retry after a continuation fails", async () => {
    const loadPage = jest.fn(async () => Promise.reject(new Error("offline")));
    renderViewer({ copyText: jest.fn(async () => undefined), loadPage });

    await act(async () => fireEvent.press(screen.getByLabelText("Load more output")));

    expect(screen.getByText("first page\n")).toBeTruthy();
    expect(screen.getByText("Could not load more output. Try again.")).toBeTruthy();
    expect(screen.getByLabelText("Load more output").props.accessibilityState).toEqual({
      busy: false,
      disabled: false,
    });
  });

  it("binds every query and cursor to the exact saved server, thread, turn, and item", async () => {
    const execute = jest.fn(async () => ({
      content: "output",
      format: "text" as const,
      itemId: "item-a",
      kind: "item.output" as const,
      next: null,
      threadId: "thread-a",
      totalBytes: "6",
      turnId: "turn-a",
    }));
    const resource = new ItemOutputResource({
      itemId: "item-a",
      owner: {
        savedServerId: savedServerId("saved-server-a"),
        threadId: threadId("thread-a"),
      },
      queries: { execute },
      turnId: "turn-a",
    });

    await expect(resource.loadPage("opaque-cursor")).resolves.toEqual({
      content: "output",
      format: "text",
      next: null,
      totalBytes: "6",
    });
    expect(execute).toHaveBeenCalledWith(savedServerId("saved-server-a"), {
      cursor: "opaque-cursor",
      itemId: "item-a",
      kind: "item.output",
      limitBytes: 65_536,
      threadId: "thread-a",
      turnId: "turn-a",
    });
  });

  it("rejects a response for another thread and a repeated cursor", async () => {
    const owner = {
      savedServerId: savedServerId("saved-server-a"),
      threadId: threadId("thread-a"),
    };
    const wrongThread = new ItemOutputResource({
      itemId: "item-a",
      owner,
      queries: {
        execute: async () => ({
          content: "private output",
          format: "text",
          itemId: "item-a",
          kind: "item.output",
          next: null,
          threadId: "thread-b",
          totalBytes: "14",
          turnId: "turn-a",
        }),
      },
      turnId: "turn-a",
    });
    const repeatedCursor = new ItemOutputResource({
      itemId: "item-a",
      owner,
      queries: {
        execute: async () => ({
          content: "page",
          format: "text",
          itemId: "item-a",
          kind: "item.output",
          next: "same",
          threadId: "thread-a",
          totalBytes: "8",
          turnId: "turn-a",
        }),
      },
      turnId: "turn-a",
    });

    await expect(wrongThread.loadPage(null)).rejects.toThrow("wrong result");
    await expect(repeatedCursor.loadPage("same")).rejects.toThrow("repeated cursor");
  });
});

interface RenderViewerInput {
  copyText(value: string): Promise<void>;
  loadPage(turnId: string, itemId: string, cursor: string): Promise<ItemOutputPage>;
}

function renderViewer(input: RenderViewerInput): void {
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <ItemOutputViewer
        copyText={input.copyText}
        initialPage={FIRST_PAGE}
        itemId="item-a"
        loadPage={input.loadPage}
        onClose={jest.fn()}
        turnId="turn-a"
      />
    </SafeAreaProvider>,
  );
}

function finalPage(): ItemOutputPage {
  return { content: "second page", format: "terminal", next: null, totalBytes: "23" };
}
