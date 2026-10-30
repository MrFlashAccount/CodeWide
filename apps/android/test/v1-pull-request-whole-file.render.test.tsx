import { RpcResponseError } from "@codewide/sync-client";
import { act, render, waitFor } from "@testing-library/react-native";
import { Suspense } from "react";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { parsePullRequestKeyParam } from "../src/data/forgeContract";
import { createForgeResources } from "../src/data/forgeResources";
import { createPullRequestCommentDestinations } from "../src/data/pullRequestCommentDestinations";
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

const filesPage = {
  files: [
    {
      additions: 1,
      deletions: 1,
      patch: {
        hunks: [
          {
            fingerprint: "b3:aa",
            id: `${PATH}#h1`,
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
      path: PATH,
      previousPath: null,
      status: "modified",
      viewed: { source: "forge", viewed: false },
    },
  ],
  headRevision: overview91.headRevision,
  nextCursor: null,
  truncated: null,
};

/** A companion whose whole-file answer the test releases when it chooses. */
function companion({ declared }: { readonly declared: boolean }) {
  const reads: { readonly method: string; readonly params: unknown }[] = [];
  let releaseContent: (answer: unknown) => void = () => undefined;
  const content = new Promise<unknown>((resolve) => {
    releaseContent = resolve;
  });
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
    "companion/pullRequest/files/read": filesPage,
    "companion/pullRequest/read": overview91,
    "companion/review/drafts/read": { drafts: [] },
  };
  const rpcAfterAttach = async <Result,>(
    _session: unknown,
    method: string,
    params: unknown,
  ): Promise<Result> => {
    reads.push({ method, params });
    const answer = method === FILE_CONTENT ? await content : answers[method];
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
    release: (answer: unknown) => {
      releaseContent(answer);
    },
    review,
  };
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
            chatVisible: true,
            closeChanges: () => undefined,
            deferReviewChatScenario: async () => Promise.resolve(null),
            openChanges: () => undefined,
            openPullRequestFullscreen: () => undefined,
            openReviewChat: () => undefined,
            openThread: () => undefined,
            pullRequestFullscreen: false,
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
function editorReady(): void {
  act(() => {
    latestWebViewProps?.onMessage?.({
      nativeEvent: { data: JSON.stringify({ type: "ready", version: 1 }) },
    });
  });
}

/** The last document the editor published to its WebView. */
function shownDocument(): CodeReviewDocument | null {
  let shown: CodeReviewDocument | null = null;
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
      "document" in message.payload
    ) {
      // WHY: the bridge message was serialized from a typed `CodeReviewDocument` by the editor.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      shown = message.payload.document as CodeReviewDocument | null;
    }
  }
  return shown;
}

function contentReads(server: ReturnType<typeof companion>) {
  return server.reads.filter((read) => read.method === FILE_CONTENT);
}

it("shows the patch while the whole file loads, then the whole file with the changes inline", async () => {
  const server = companion({ declared: true });
  const view = renderChanges(server);
  await view.findByTestId("pull-request-diff");
  editorReady();
  await waitFor(() => {
    expect(shownDocument()?.path).toBe(PATH);
  });
  expect(shownDocument()).toMatchObject({ source: "" });
  expect(shownDocument()?.fullFileDiff).toBeUndefined();
  await waitFor(() => {
    expect(contentReads(server)).toHaveLength(1);
  });
  expect(contentReads(server)[0]?.params).toEqual({
    headRevision: overview91.headRevision,
    path: PATH,
    pullRequest: overview91.pullRequest,
  });

  await act(async () => {
    server.release({ content: HEAD_FILE, state: "text" });
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(shownDocument()).toMatchObject({ fullFileDiff: true, path: PATH, source: HEAD_FILE });
  });
  expect(shownDocument()?.patches).toEqual([{ diff: PATCH, kind: "update" }]);
});

it("keeps the patch view when the whole file is too large", async () => {
  const server = companion({ declared: true });
  const view = renderChanges(server);
  await view.findByTestId("pull-request-diff");
  editorReady();
  await waitFor(() => {
    expect(contentReads(server)).toHaveLength(1);
  });
  await act(async () => {
    server.release({ bytes: 5_000_000, state: "tooLarge" });
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(
      server.forge.fileContent.data({
        connectionId: "server",
        headRevision: overview91.headRevision,
        path: PATH,
        // WHY: the fixture key was parsed into this brand by the screen above.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        pullRequest: PULL_REQUEST as NonNullable<typeof PULL_REQUEST>,
      }),
    ).toEqual({ bytes: 5_000_000, state: "tooLarge" });
  });
  expect(shownDocument()).toMatchObject({ path: PATH, source: "" });
  expect(shownDocument()?.fullFileDiff).toBeUndefined();
});

it("never asks for the whole file when the plugin does not declare it", async () => {
  const server = companion({ declared: false });
  const view = renderChanges(server);
  await view.findByTestId("pull-request-diff");
  editorReady();
  await waitFor(() => {
    expect(shownDocument()?.path).toBe(PATH);
  });
  await waitFor(() => {
    expect(server.reads.some((read) => read.method === "companion/forge/accounts/read")).toBe(true);
  });
  expect(contentReads(server)).toEqual([]);
  expect(shownDocument()).toMatchObject({ source: "" });
});
