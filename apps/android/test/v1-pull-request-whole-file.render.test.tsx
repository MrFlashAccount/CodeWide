import { RpcResponseError } from "@codewide/sync-client";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Suspense } from "react";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { parsePullRequestKeyParam } from "../src/data/forgeContract";
import { createForgeResources } from "../src/data/forgeResources";
import { createPullRequestCommentDestinations } from "../src/data/pullRequestCommentDestinations";
import { createReviewResources } from "../src/data/reviewResources";
import { PullRequestScreen } from "../src/features/pullRequestDetail/PullRequestScreen";
import { WHOLE_FILE_WAIT_MS } from "../src/features/pullRequestDetail/changes/headFileViews";
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

/**
 * A companion whose whole-file answers the test releases per path when it
 * chooses, or answers at once with the head file when `answerAtOnce` is set.
 */
function companion({
  answerAtOnce = false,
  declared,
  paths = [PATH],
}: {
  readonly answerAtOnce?: boolean;
  readonly declared: boolean;
  readonly paths?: readonly string[];
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
        ? answerAtOnce
          ? { content: HEAD_FILE, state: "text" }
          : await contentOf(pathOf(params)).promise
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
      <Suspense fallback={<Text>Loading pull request</Text>}>
        <PullRequestScreen
          capabilities={capabilities()}
          commentDestinations={createPullRequestCommentDestinations({
            deleteConnection: async () => undefined,
            read: async () => null,
            write: async () => undefined,
          })}
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
        />
      </Suspense>
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

it("gives the editor the whole file once it is read, never the patch first", async () => {
  const server = companion({ declared: true });
  const view = renderChanges(server);
  await view.findByTestId("pull-request-diff");
  await editorReady();
  await waitFor(() => {
    expect(contentReads(server)).toEqual([PATH]);
  });
  expect(server.reads.find((read) => read.method === FILE_CONTENT)?.params).toEqual({
    headRevision: overview91.headRevision,
    path: PATH,
    pullRequest: overview91.pullRequest,
  });
  expect(postedDocuments()).toEqual([]);

  await act(async () => {
    server.release(PATH, { content: HEAD_FILE, state: "text" });
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(lastDocument()).toMatchObject({ fullFileDiff: true, path: PATH, source: HEAD_FILE });
  });
  expect(lastDocument()?.patches).toEqual([{ diff: PATCH, kind: "update" }]);
  expect(revisionsOf(PATH)).toHaveLength(1);
});

it("gives the editor the patch once when the whole file is too large", async () => {
  const server = companion({ declared: true });
  const view = renderChanges(server);
  await view.findByTestId("pull-request-diff");
  await editorReady();
  await waitFor(() => {
    expect(contentReads(server)).toEqual([PATH]);
  });
  await act(async () => {
    server.release(PATH, { bytes: 5_000_000, state: "tooLarge" });
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(lastDocument()).toMatchObject({ path: PATH, source: "" });
  });
  expect(lastDocument()?.fullFileDiff).toBeUndefined();
  expect(revisionsOf(PATH)).toHaveLength(1);
});

it("settles on the patch when the whole file outlasts the wait, and keeps it when it arrives", async () => {
  jest.useFakeTimers();
  try {
    const other = "src/lib.rs";
    const server = companion({ declared: true, paths: [PATH, other] });
    const view = renderChanges(server);
    await view.findByTestId("pull-request-diff");
    await editorReady();
    await waitFor(() => {
      expect(contentReads(server)).toEqual([PATH, other]);
    });
    await act(async () => {
      jest.advanceTimersByTime(WHOLE_FILE_WAIT_MS - 1);
      await Promise.resolve();
    });
    expect(postedDocuments()).toEqual([]);

    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(lastDocument()).toMatchObject({ path: PATH, source: "" });
    });
    const patchRevision = lastDocument()?.revision;

    await act(async () => {
      server.release(PATH, { content: HEAD_FILE, state: "text" });
      server.release(other, { content: HEAD_FILE, state: "text" });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        server.forge.queryClient.getQueryData([
          "forge",
          "fileContent",
          "server",
          overview91.pullRequest,
          overview91.headRevision,
          PATH,
        ]),
      ).toEqual({ content: HEAD_FILE, state: "text" });
    });
    // The same view re-renders (the file tree toggles) but keeps its patch.
    fireEvent.press(view.getByTestId("changes-view-files"));
    await act(async () => {
      jest.advanceTimersByTime(WHOLE_FILE_WAIT_MS);
      await Promise.resolve();
    });
    expect(revisionsOf(PATH)).toEqual([patchRevision]);

    // A later visit of the file finds the answer and shows the whole file at once.
    await selectInTree(other);
    await waitFor(() => {
      expect(lastDocument()).toMatchObject({ fullFileDiff: true, path: other });
    });
    await selectInTree(PATH);
    await waitFor(() => {
      expect(lastDocument()).toMatchObject({ fullFileDiff: true, path: PATH });
    });
    expect(revisionsOf(PATH)).toHaveLength(2);
    expect(revisionsOf(other)).toHaveLength(1);
  } finally {
    jest.useRealTimers();
  }
});

it("reads ahead the first files and the selected file's neighbours", async () => {
  const paths = ["src/a.rs", "src/b.rs", "src/c.rs", "src/d.rs", "src/e.rs"];
  const server = companion({ answerAtOnce: true, declared: true, paths });
  const view = renderChanges(server);
  await view.findByTestId("pull-request-diff");
  await editorReady();
  await waitFor(() => {
    expect(new Set(contentReads(server))).toEqual(new Set(paths.slice(0, 3)));
  });
  await waitFor(() => {
    expect(lastDocument()).toMatchObject({ fullFileDiff: true, path: "src/a.rs" });
  });

  await selectInTree("src/b.rs");
  await waitFor(() => {
    expect(lastDocument()).toMatchObject({ fullFileDiff: true, path: "src/b.rs" });
  });
  await selectInTree("src/c.rs");
  await waitFor(() => {
    expect(contentReads(server)).toContain("src/d.rs");
  });
  await waitFor(() => {
    expect(lastDocument()).toMatchObject({ fullFileDiff: true, path: "src/c.rs" });
  });
  expect(contentReads(server)).not.toContain("src/e.rs");
  // Every file was read once, and each view gave the editor one document.
  expect(contentReads(server)).toHaveLength(new Set(contentReads(server)).size);
  for (const path of paths.slice(0, 3)) {
    expect(revisionsOf(path)).toHaveLength(1);
  }
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
  expect(lastDocument()).toMatchObject({ source: "" });
  expect(revisionsOf(PATH)).toHaveLength(1);
});
