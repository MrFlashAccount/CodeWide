import { RpcResponseError } from "@codewide/sync-client";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Suspense } from "react";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppNoticeProvider } from "../src/ui/AppNotice";
import { parsePullRequestKeyParam } from "../src/data/forgeContract";
import { createForgeResources } from "../src/data/forgeResources";
import { createReviewResources } from "../src/data/reviewResources";
import { PullRequestScreen } from "../src/features/pullRequestDetail/PullRequestScreen";
import type { PullRequestDetailWorkspaceCapabilities } from "../src/features/pullRequestDetail/workspaceCapabilities";
import type { CodeReviewDocument } from "../src/features/review/editor/editorBridge";
import type { ReviewTargetCapabilities } from "../src/features/review/reviewTargetCapabilities";
import { connectedAccount, githubProvider, overview91 } from "./fixtures/forgeWireFixtures";
import { createMemoryQueryPersister } from "./fixtures/queryPersister";
import { latestWebViewProps, webViewPostedMessages } from "./mocks/ReactNativeWebView";

// WHY: Expo's filesystem bridge cannot initialize in Node; the editor's suggestion popup imports it.
jest.mock("expo-file-system/legacy", () => ({ cacheDirectory: null }));

const PULL_REQUEST = parsePullRequestKeyParam(overview91.pullRequest);
const FILE_CONTENT = "companion/pullRequest/fileContent/read";
const PATH = "src/main.rs";
const HEAD_FILE = ["use std::io;", "", "fn main() {", "    new();", "}", ""].join("\n");
const PATCH = "@@ -2,4 +2,4 @@ use std::io;\n \n fn main() {\n-    old();\n+    new();\n }";

function modifiedFile(path: string) {
  return {
    additions: 1,
    deletions: 1,
    patch: {
      hunks: [
        {
          fingerprint: "b3:aa",
          id: `${path}#h1`,
          newLines: 4,
          newStart: 2,
          oldLines: 4,
          oldStart: 2,
          ordinal: 1,
        },
      ],
      state: "present",
      text: PATCH,
    },
    path,
    previousPath: null,
    status: "modified",
    viewed: { source: "forge", viewed: false },
  };
}

function filesPage(paths: readonly string[]) {
  return {
    files: paths.map(modifiedFile),
    headRevision: overview91.headRevision,
    nextCursor: null,
    truncated: null,
  };
}

/** A companion whose file reads resolve independently for each requested path. */
function companion({
  declared,
  paths = [PATH],
  readContent,
  readFiles,
}: {
  readonly declared: boolean;
  readonly paths?: readonly string[];
  readonly readContent?: (path: string) => Promise<unknown>;
  readonly readFiles?: (cursor: unknown) => Promise<unknown>;
}) {
  const reads: { readonly method: string; readonly params: unknown }[] = [];
  const pending = new Map<
    string,
    { promise: Promise<unknown>; resolve: (answer: unknown) => void }
  >();
  const contentOf = (path: string) => {
    const known = pending.get(path);
    if (known !== undefined) {
      return known;
    }
    let resolve: (answer: unknown) => void = () => undefined;
    const promise = new Promise<unknown>((settle) => {
      resolve = settle;
    });
    const entry = { promise, resolve };
    pending.set(path, entry);
    return entry;
  };
  const answers: Readonly<Record<string, unknown>> = {
    "companion/forge/accounts/read": {
      accounts: [connectedAccount],
      flows: [],
      providers: [
        declared
          ? {
              ...githubProvider,
              capabilities: [...githubProvider.capabilities, "forge.fileContent@1"],
            }
          : githubProvider,
      ],
    },
    "companion/pullRequest/files/read": filesPage(paths),
    "companion/pullRequest/read": overview91,
    "companion/review/drafts/read": { drafts: [] },
  };
  const rpcAfterAttach = async <Result,>(
    _session: unknown,
    method: string,
    params: unknown,
  ): Promise<Result> => {
    reads.push({ method, params });
    const answer =
      method === FILE_CONTENT
        ? await (readContent?.(pathOf(params)) ?? contentOf(pathOf(params)).promise)
        : method === "companion/pullRequest/files/read" && readFiles !== undefined
          ? await readFiles(
              typeof params === "object" && params !== null && "cursor" in params
                ? params.cursor
                : null,
            )
          : answers[method];
    if (answer === undefined) {
      throw new RpcResponseError(-32_601, `Unknown ${method}`);
    }
    // WHY: the fake transport returns wire fixtures; the app's own parsers validate them.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return answer as Result;
  };
  // WHY: the fake session is only a handle passed back to rpcAfterAttach.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const session = {} as never;
  const forge = createForgeResources({
    getSession: () => session,
    persister: createMemoryQueryPersister().persister,
    reportDroppedAction: () => undefined,
    rpcAfterAttach,
  });
  const review = createReviewResources({
    getSession: () => session,
    queryClient: forge.queryClient,
    rpcAfterAttach,
  });
  return {
    forge,
    reads,
    release: (path: string, answer: unknown) => {
      contentOf(path).resolve(answer);
    },
    review,
  };
}

function pathOf(params: unknown): string {
  return typeof params === "object" && params !== null && "path" in params
    ? String(params.path)
    : "";
}

function capabilities(): PullRequestDetailWorkspaceCapabilities {
  const unused = async (): Promise<never> => Promise.reject(new Error("not part of this test"));
  return {
    createComment: unused,
    ensureReviewChat: unused,
    markAttentionSeen: async () => undefined,
    replyToReviewThread: unused,
    resolveReviewThread: unused,
    runAction: unused,
    setLink: unused,
    setViewed: unused,
    startScenario: unused,
    submitReview: unused,
    transferAccess: unused,
  };
}

const mounted: { readonly clear: () => void; readonly unmount: () => void }[] = [];

afterEach(async () => {
  await act(async () => {
    for (const screen of mounted.splice(0)) {
      screen.unmount();
      screen.clear();
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
});

function renderChanges(server: ReturnType<typeof companion>) {
  if (PULL_REQUEST === null) {
    throw new Error("the pull request key fixture must parse");
  }
  webViewPostedMessages.length = 0;
  const view = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 900, width: 420, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <AppNoticeProvider>
        <Suspense fallback={<Text>Loading pull request</Text>}>
          <PullRequestScreen
            capabilities={capabilities()}
            connectionId="server"
            describeThread={() => null}
            forge={server.forge}
            initialChangesView="files"
            isThreadUnread={() => false}
            navigation={{
              back: () => undefined,
              closeChanges: () => undefined,
              deferReviewChatScenario: async () => Promise.resolve(null),
              openChanges: () => undefined,
              openReviewChat: () => undefined,
              openThread: () => undefined,
            }}
            pullRequest={PULL_REQUEST}
            review={server.review}
            // WHY: no draft is written here; the review target is never called.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion
            reviewCapabilities={{} as ReviewTargetCapabilities}
            tab="changes"
            tablet={false}
            voiceRuntime={null}
          />
        </Suspense>
      </AppNoticeProvider>
    </SafeAreaProvider>,
  );
  mounted.push({ clear: () => server.forge.queryClient.clear(), unmount: view.unmount });
  return view;
}

/** Tells the editor its WebView is ready, so it publishes the selected document. */
async function editorReady(): Promise<void> {
  await act(async () => {
    latestWebViewProps?.onMessage?.({
      nativeEvent: { data: JSON.stringify({ type: "ready", version: 1 }) },
    });
    await Promise.resolve();
  });
}

/** Chooses `path` in the editor's file tree, answering its latest document request. */
async function selectInTree(path: string): Promise<void> {
  let requestId = 0;
  for (const serialized of webViewPostedMessages) {
    const message: unknown = JSON.parse(serialized);
    if (
      typeof message === "object" &&
      message !== null &&
      "command" in message &&
      message.command === "document" &&
      "payload" in message &&
      typeof message.payload === "object" &&
      message.payload !== null &&
      "requestId" in message.payload &&
      typeof message.payload.requestId === "number"
    ) {
      requestId = message.payload.requestId;
    }
  }
  await act(async () => {
    latestWebViewProps?.onMessage?.({
      nativeEvent: { data: JSON.stringify({ path, requestId, type: "fileSelect", version: 1 }) },
    });
    await Promise.resolve();
  });
}

/** Every non-empty document the editor published to its WebView, in order. */
function postedDocuments(): readonly CodeReviewDocument[] {
  const shown: CodeReviewDocument[] = [];
  for (const serialized of webViewPostedMessages) {
    const message: unknown = JSON.parse(serialized);
    if (
      typeof message === "object" &&
      message !== null &&
      "command" in message &&
      message.command === "document" &&
      "payload" in message &&
      typeof message.payload === "object" &&
      message.payload !== null &&
      "document" in message.payload &&
      message.payload.document !== null
    ) {
      // WHY: the bridge message was serialized from a typed `CodeReviewDocument` by the editor.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      shown.push(message.payload.document as CodeReviewDocument);
    }
  }
  return shown;
}

/** The distinct document revisions the editor was given for `path`: one per atomic view. */
function revisionsOf(path: string): readonly string[] {
  return [
    ...new Set(
      postedDocuments()
        .filter((document) => document.path === path)
        .map((document) => document.revision),
    ),
  ];
}

function lastDocument(): CodeReviewDocument | null {
  return postedDocuments().at(-1) ?? null;
}

function contentReads(server: ReturnType<typeof companion>): readonly string[] {
  return server.reads
    .filter((read) => read.method === FILE_CONTENT)
    .map((read) => pathOf(read.params));
}

it("shows the recorded patch immediately; Expand and Collapse keep the diff on the same file", async () => {
  const server = companion({ declared: true });
  const view = renderChanges(server);
  await view.findByTestId("pull-request-diff");
  await editorReady();
  await waitFor(() => expect(lastDocument()).toMatchObject({ path: PATH, source: "" }));
  const patch = lastDocument();
  expect(contentReads(server)).toEqual([]);

  fireEvent.press(await view.findByRole("button", { name: "Expand file" }));
  await waitFor(() => expect(contentReads(server)).toEqual([PATH]));
  expect(server.reads.find((read) => read.method === FILE_CONTENT)?.params).toEqual({
    headRevision: overview91.headRevision,
    path: PATH,
    pullRequest: overview91.pullRequest,
  });
  expect(lastDocument()).toEqual(patch);
  await act(async () => server.release(PATH, { content: HEAD_FILE, state: "text" }));
  await waitFor(() =>
    expect(lastDocument()).toMatchObject({ fullFileDiff: true, path: PATH, source: HEAD_FILE }),
  );
  expect(lastDocument()?.patches).toEqual([{ diff: PATCH, kind: "update" }]);
  fireEvent.press(view.getByRole("button", { name: "Collapse file" }));
  await waitFor(() => expect(lastDocument()).toEqual(patch));
});

it.each([
  [{ bytes: 5_000_000, state: "tooLarge" }, "File is too large to display"],
  [{ content: "different source", state: "text" }, "File content does not match this patch."],
])("keeps the patch and explains why expansion is unavailable", async (answer, reason) => {
  const server = companion({ declared: true });
  const view = renderChanges(server);
  await view.findByTestId("pull-request-diff");
  await editorReady();
  fireEvent.press(await view.findByRole("button", { name: "Expand file" }));
  await act(async () => server.release(PATH, answer));
  expect(await view.findByText(reason)).toBeTruthy();
  expect(
    view.getByRole("button", { disabled: true, expanded: false, name: "Full file unavailable" }),
  ).toBeTruthy();
  expect(lastDocument()).toMatchObject({ path: PATH, source: "" });
});

it("keeps the patch on a transport failure and retries the same file on request", async () => {
  const readContent = jest
    .fn()
    .mockRejectedValueOnce(new RpcResponseError(-32087, "Rate limited"))
    .mockResolvedValueOnce({ content: HEAD_FILE, state: "text" });
  const server = companion({ declared: true, readContent });
  const view = renderChanges(server);
  await view.findByTestId("pull-request-diff");
  await editorReady();
  fireEvent.press(await view.findByRole("button", { name: "Expand file" }));
  const retry = await view.findByRole("button", { expanded: false, name: "Retry expanding file" });
  expect(lastDocument()).toMatchObject({ path: PATH, source: "" });
  fireEvent.press(retry);
  await waitFor(() =>
    expect(lastDocument()).toMatchObject({ fullFileDiff: true, source: HEAD_FILE }),
  );
  expect(contentReads(server)).toEqual([PATH, PATH]);
});

it("remembers expansion per file and never reads neighbours or applies a late answer to another file", async () => {
  const other = "src/lib.rs";
  const server = companion({ declared: true, paths: [PATH, other, "src/unused.rs"] });
  const view = renderChanges(server);
  await view.findByTestId("pull-request-diff");
  await editorReady();
  fireEvent.press(await view.findByRole("button", { name: "Expand file" }));
  await selectInTree(other);
  await waitFor(() => expect(lastDocument()).toMatchObject({ path: other, source: "" }));
  expect(view.getByRole("button", { name: "Expand file" })).toBeTruthy();
  await act(async () => server.release(PATH, { content: HEAD_FILE, state: "text" }));
  expect(lastDocument()).toMatchObject({ path: other, source: "" });
  await selectInTree(PATH);
  await waitFor(() =>
    expect(lastDocument()).toMatchObject({ fullFileDiff: true, path: PATH, source: HEAD_FILE }),
  );
  expect(contentReads(server)).toEqual([PATH]);
});

it("keeps a collapsed patch when a pending expansion finishes", async () => {
  const server = companion({ declared: true });
  const view = renderChanges(server);
  await view.findByTestId("pull-request-diff");
  await editorReady();
  fireEvent.press(await view.findByRole("button", { name: "Expand file" }));
  fireEvent.press(await view.findByRole("button", { name: "Cancel expanding file" }));
  await act(async () => server.release(PATH, { content: HEAD_FILE, state: "text" }));
  expect(lastDocument()).toMatchObject({ path: PATH, source: "" });
  expect(revisionsOf(PATH)).toHaveLength(1);
});

it("never asks for the whole file when the plugin does not declare it", async () => {
  const server = companion({ declared: false });
  const view = renderChanges(server);
  await view.findByTestId("pull-request-diff");
  await editorReady();
  await waitFor(() => {
    expect(lastDocument()?.path).toBe(PATH);
  });
  await waitFor(() => {
    expect(server.reads.some((read) => read.method === "companion/forge/accounts/read")).toBe(true);
  });
  expect(contentReads(server)).toEqual([]);
  expect(view.queryByRole("button", { name: "Expand file" })).toBeNull();
  expect(lastDocument()).toMatchObject({ source: "" });
  expect(revisionsOf(PATH)).toHaveLength(1);
});

it("opens the first diff immediately and indexes subsequent pages as the file picker needs them", async () => {
  const later = Promise.withResolvers<unknown>();
  const last = Promise.withResolvers<unknown>();
  const readFiles = jest.fn(async (cursor: unknown) => {
    if (cursor === "next") return later.promise;
    if (cursor === "last") return last.promise;
    return { ...filesPage([PATH]), nextCursor: "next" };
  });
  const server = companion({ declared: false, readFiles });
  const view = renderChanges(server);
  await view.findByTestId("pull-request-diff");
  await editorReady();
  await waitFor(() => expect(lastDocument()?.path).toBe(PATH));
  expect(readFiles.mock.calls).toEqual([[null]]);
  fireEvent.press(view.getByTestId("changes-view-files"));
  await waitFor(() => expect(readFiles.mock.calls).toEqual([[null], ["next"]]));
  expect(view.queryByText("Show more files")).toBeNull();
  await act(async () => later.resolve({ ...filesPage(["src/middle.rs"]), nextCursor: "last" }));
  await waitFor(() => expect(treePaths()).toEqual([PATH, "src/middle.rs"]));
  await act(async () =>
    last.resolve({ ...filesPage(["src/final.rs"]), truncated: { shown: 3, total: 7 } }),
  );
  await waitFor(() => expect(treePaths()).toEqual([PATH, "src/middle.rs", "src/final.rs"]));
  expect(view.getByText("Forge shows 3 of 7 files")).toBeTruthy();
  await selectInTree("src/final.rs");
  await waitFor(() => expect(lastDocument()?.path).toBe("src/final.rs"));
  fireEvent.press(view.getByTestId("changes-view-files"));
  expect(readFiles.mock.calls).toEqual([[null], ["next"], ["last"]]);
});

it("retries only the missing page after a failure without losing the loaded tree", async () => {
  let failed = false;
  const readFiles = jest.fn(async (cursor: unknown) => {
    if (cursor === null) return { ...filesPage([PATH]), nextCursor: "middle" };
    if (cursor === "middle") return { ...filesPage(["src/b.rs"]), nextCursor: "last" };
    if (!failed) {
      failed = true;
      throw new RpcResponseError(-32087, "Rate limited");
    }
    return filesPage(["src/c.rs"]);
  });
  const view = renderChanges(companion({ declared: false, readFiles }));
  await view.findByTestId("pull-request-diff");
  await editorReady();
  const pane = view.getByTestId("pull-request-changes");
  fireEvent(pane, "layout", { nativeEvent: { layout: { width: 1200 } } });
  const retry = await view.findByText("Try again");
  expect(treePaths()).toEqual([PATH, "src/b.rs"]);
  fireEvent.press(retry);
  await waitFor(() => expect(treePaths()).toEqual([PATH, "src/b.rs", "src/c.rs"]));
  expect(readFiles.mock.calls).toEqual([[null], ["middle"], ["last"], ["last"]]);
});

function treePaths(): readonly string[] {
  for (const serialized of webViewPostedMessages.toReversed()) {
    const message = JSON.parse(serialized);
    if (message.command === "workspace") {
      return message.payload.files.map((item: { path: string }) => item.path);
    }
  }
  return [];
}
