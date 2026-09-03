import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { V2QueryResult } from "@codewide/sync-client/v2";

import { ThreadChangeOutputResource } from "../src/v2/features/changes/threadChangeOutputResource";
import { savedServerId, threadId } from "../src/v2/domain/ids";
import { PagedTextViewer, type PagedTextPage } from "../src/v2/presentation/output/PagedTextViewer";

const FIRST_PAGE: PagedTextPage = {
  content: "x".repeat(65_536),
  format: "text",
  next: "opaque-next",
  totalBytes: "65542",
};

type ThreadChangeOutputResult = Extract<V2QueryResult, { kind: "thread.changeOutput" }>;

describe("V2 full change output", () => {
  it("loads diff content beyond the first bounded page", async () => {
    const loadPage = jest.fn(async () => finalPage());
    renderViewer(loadPage);

    await act(async () => fireEvent.press(screen.getByLabelText("Load more diff")));

    expect(loadPage).toHaveBeenCalledWith("opaque-next");
    expect(screen.getByText(`${FIRST_PAGE.content}\n+tail`)).toBeTruthy();
    expect(screen.queryByLabelText("Load more diff")).toBeNull();
  });

  it("binds every page to the exact server, thread, path, and scope", async () => {
    const execute = jest.fn(async () => ({
      content: "+tail",
      kind: "thread.changeOutput" as const,
      next: null,
      path: "/workspace/src/main.ts",
      scope: "session" as const,
      threadId: "thread-a",
      totalBytes: "5",
    }));
    const resource = new ThreadChangeOutputResource({
      owner: {
        savedServerId: savedServerId("saved-server-a"),
        threadId: threadId("thread-a"),
      },
      path: "/workspace/src/main.ts",
      queries: { execute },
      scope: "session",
    });

    await expect(resource.loadPage("opaque-cursor")).resolves.toEqual({
      content: "+tail",
      format: "text",
      next: null,
      totalBytes: "5",
    });
    expect(execute).toHaveBeenCalledWith(savedServerId("saved-server-a"), {
      cursor: "opaque-cursor",
      kind: "thread.changeOutput",
      limitBytes: 65_536,
      path: "/workspace/src/main.ts",
      scope: "session",
      threadId: "thread-a",
    });
  });

  it("rejects cross-thread and repeated-cursor responses", async () => {
    const wrongThread = resourceReturning({
      content: "private",
      kind: "thread.changeOutput",
      next: null,
      path: "/workspace/src/main.ts",
      scope: "session",
      threadId: "thread-b",
      totalBytes: "7",
    });
    const repeated = resourceReturning({
      content: "page",
      kind: "thread.changeOutput",
      next: "same",
      path: "/workspace/src/main.ts",
      scope: "session",
      threadId: "thread-a",
      totalBytes: "8",
    });

    await expect(wrongThread.loadPage(null)).rejects.toThrow("wrong result");
    await expect(repeated.loadPage("same")).rejects.toThrow("repeated cursor");
  });
});

function renderViewer(loadPage: (cursor: string) => Promise<PagedTextPage>): void {
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <PagedTextViewer
        contentName="diff"
        copyText={jest.fn(async () => undefined)}
        emptyLabel="No diff output."
        initialPage={FIRST_PAGE}
        loadPage={loadPage}
        onClose={jest.fn()}
        title="Full diff"
      />
    </SafeAreaProvider>,
  );
}

function finalPage(): PagedTextPage {
  return { content: "\n+tail", format: "text", next: null, totalBytes: "65542" };
}

function resourceReturning(result: ThreadChangeOutputResult): ThreadChangeOutputResource {
  return new ThreadChangeOutputResource({
    owner: {
      savedServerId: savedServerId("saved-server-a"),
      threadId: threadId("thread-a"),
    },
    path: "/workspace/src/main.ts",
    queries: { execute: async () => result },
    scope: "session",
  });
}
