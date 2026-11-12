import { RpcResponseError } from "@codewide/sync-client";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { Suspense, type ReactNode } from "react";
import { Text } from "react-native";
import type { EnrichedMarkdownTextInputProps } from "react-native-enriched-markdown";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { parsePullRequestKeyParam } from "../src/data/forgeContract";
import { createForgeResources } from "../src/data/forgeResources";
import { createReviewResources } from "../src/data/reviewResources";
import { PullRequestScreen } from "../src/features/pullRequestDetail/PullRequestScreen";
import type { PullRequestDetailWorkspaceCapabilities } from "../src/features/pullRequestDetail/workspaceCapabilities";
import type { CodeReviewInlineComment } from "../src/features/review/editor/editorBridge";
import { createReviewTargetAdapter } from "../src/features/review/reviewTargetAdapter";
import type { AppVoiceInputRuntime } from "../src/ui/VoiceInputRuntime";
import { connectedAccount, githubProvider, overview91 } from "./fixtures/forgeWireFixtures";
import { createMemoryQueryPersister } from "./fixtures/queryPersister";
import { setKeyboardHeightForTest } from "./mocks/KeyboardController";
import { latestWebViewProps, webViewPostedMessages } from "./mocks/ReactNativeWebView";

// WHY: Expo's filesystem bridge cannot initialize in Node; the editor's suggestion popup imports it.
jest.mock("expo-file-system/legacy", () => ({ cacheDirectory: null }));

// WHY: The native Markdown editor requires Fabric. This adapter replaces only its platform view;
// typing is simulated through the same text and Markdown events the native editor emits.
jest.mock("react-native-enriched-markdown", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View: MockView } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    EnrichedMarkdownTextInput: React.forwardRef(function Editor(
      props: EnrichedMarkdownTextInputProps,
      ref,
    ) {
      React.useImperativeHandle(ref, () => ({
        focus: jest.fn(),
        getMarkdown: async () => Promise.resolve(""),
        setSelection: jest.fn(),
        setValue: jest.fn(),
      }));
      return <MockView {...props} testID="native-editor" />;
    }),
  };
});

/** How many times any `AppSheet` rendered; the docked line composer must never open one. */
let sheetRenders = 0;
// WHY: the native Material sheet window cannot mount in the Node renderer; this records that
// the line composer is docked in the pane instead of presented in a modal window.
jest.mock("../src/ui/AppSheet", () => {
  const { View: MockView } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    AppSheet: ({ children }: { readonly children: ReactNode }) => {
      sheetRenders += 1;
      return <MockView>{children}</MockView>;
    },
    AppSheetScrollView: ({ children }: { readonly children: ReactNode }) => (
      <MockView>{children}</MockView>
    ),
  };
});

// WHY: the Android permission bridge cannot run in Node; the composer only asks whether capture is allowed.
jest.mock("../src/ui/use-microphone-access", () => ({
  useMicrophoneAccess: () => ({
    allowCapture: () => true,
    granted: true,
    run: (operation: () => Promise<void>) => {
      void operation();
    },
  }),
}));

const PULL_REQUEST = parsePullRequestKeyParam(overview91.pullRequest);
const PATH = "src/main.rs";
const PATCH = "@@ -2,4 +2,4 @@ use std::io;\n \n fn main() {\n-    old();\n+    new();\n }";
const DRAFT_PUT = "companion/review/draft/put";
const LINE = { coordinate: "file", line: 4, path: PATH, side: "new" } as const;
const OTHER_LINE = { coordinate: "file", line: 3, path: PATH, side: "new" } as const;

function filesPage() {
  return {
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
}

/** One `companion/review/draft/put` the test answers when it chooses. */
type PendingPut = {
  readonly params: { readonly draft: Record<string, unknown> };
  readonly reject: (error: Error) => void;
  readonly resolve: () => void;
};

/** A companion whose draft writes wait for the test; acknowledged drafts join the drafts read. */
function companion() {
  const puts: PendingPut[] = [];
  const saved: unknown[] = [];
  const answers: Readonly<Record<string, unknown>> = {
    "companion/forge/accounts/read": {
      accounts: [connectedAccount],
      flows: [],
      providers: [githubProvider],
    },
    "companion/pullRequest/files/read": filesPage(),
    "companion/pullRequest/read": overview91,
  };
  const rpcAfterAttach = async <Result,>(
    _session: unknown,
    method: string,
    params: unknown,
  ): Promise<Result> => {
    const answer =
      method === DRAFT_PUT
        ? await new Promise<unknown>((resolve, reject) => {
            // WHY: the app sent these params through its own typed DraftInput.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion
            const put = params as PendingPut["params"];
            puts.push({
              params: put,
              reject,
              resolve: () => {
                const draft = {
                  ...put.draft,
                  author: { kind: "user" },
                  createdAt: "2026-11-06T10:00:00Z",
                  pr: { error: null, state: "pending" },
                  updatedAt: "2026-11-06T10:00:00Z",
                  version: 1,
                };
                saved.push(draft);
                resolve(draft);
              },
            });
          })
        : method === "companion/review/drafts/read"
          ? { drafts: [...saved], revision: "drafts-1" }
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
  const reviewTarget = createReviewTargetAdapter({
    getSession: () => session,
    mutations: forge.mutations,
    resources: review,
    rpcAfterAttach,
  });
  return { forge, puts, review, reviewTarget };
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

/** The retained voice controller as the composer sees it; nothing records in this test. */
function voiceRuntime(): AppVoiceInputRuntime {
  const resolved = async () => Promise.resolve();
  return {
    controller: {
      activeCaptureScope: () => null,
      bind: () => undefined,
      clearPendingSelection: () => undefined,
      finish: resolved,
      level: () => 0,
      retry: resolved,
      subscribeActiveCapture: () => () => undefined,
      subscribeLevel: () => () => undefined,
      toggle: resolved,
      unbind: () => undefined,
    },
    resources: null,
    scopePrefix: "pull-request-test",
    thread: null,
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

async function renderChanges(
  server: ReturnType<typeof companion>,
  { bottomInset = 0 }: { readonly bottomInset?: number } = {},
) {
  if (PULL_REQUEST === null) {
    throw new Error("the pull request key fixture must parse");
  }
  webViewPostedMessages.length = 0;
  sheetRenders = 0;
  const view = render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 900, width: 420, x: 0, y: 0 },
        insets: { bottom: bottomInset, left: 0, right: 0, top: 0 },
      }}
    >
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
          reviewCapabilities={server.reviewTarget}
          tab="changes"
          tablet={false}
          voiceRuntime={voiceRuntime()}
        />
      </Suspense>
    </SafeAreaProvider>,
  );
  mounted.push({ clear: () => server.forge.queryClient.clear(), unmount: view.unmount });
  await view.findByTestId("pull-request-diff");
  await act(async () => {
    latestWebViewProps?.onMessage?.({
      nativeEvent: { data: JSON.stringify({ type: "ready", version: 1 }) },
    });
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(documentRequestId()).not.toBeNull();
  });
  return view;
}

/** The host commands the editor posted to its WebView, in order. */
function postedCommands(): readonly { readonly command: string; readonly payload: unknown }[] {
  return webViewPostedMessages.map((serialized) => {
    const message: unknown = JSON.parse(serialized);
    if (
      typeof message !== "object" ||
      message === null ||
      !("command" in message) ||
      typeof message.command !== "string" ||
      !("payload" in message)
    ) {
      throw new Error("The editor posted a malformed host command");
    }
    return { command: message.command, payload: message.payload };
  });
}

function documentRequestId(): number | null {
  for (const { command, payload } of postedCommands().toReversed()) {
    if (
      command === "document" &&
      typeof payload === "object" &&
      payload !== null &&
      "requestId" in payload &&
      typeof payload.requestId === "number" &&
      "document" in payload &&
      payload.document !== null
    ) {
      return payload.requestId;
    }
  }
  return null;
}

/** The inline comments the editor last drew for the shown file. */
function inlineComments(): readonly CodeReviewInlineComment[] {
  const last = postedCommands()
    .filter(({ command }) => command === "comments")
    .at(-1);
  // WHY: the editor serialized this payload from its typed `CodeReviewInlineComment[]` prop.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (last?.payload ?? []) as readonly CodeReviewInlineComment[];
}

async function tapLine(reference: typeof LINE | typeof OTHER_LINE = LINE): Promise<void> {
  await act(async () => {
    latestWebViewProps?.onMessage?.({
      nativeEvent: {
        data: JSON.stringify({
          reference,
          requestId: documentRequestId(),
          type: "lineTap",
          version: 1,
        }),
      },
    });
    await Promise.resolve();
  });
}

function typeComment(view: ReturnType<typeof render>, text: string): void {
  const editor = within(view.getByTestId("review-line-composer")).getByTestId("native-editor");
  act(() => {
    editor.props.onChangeText(text);
    editor.props.onChangeMarkdown(text);
  });
}

/** The anchor line the editor was last asked to highlight. */
function highlighted(): unknown {
  return postedCommands()
    .filter(({ command }) => command === "selection")
    .at(-1)?.payload;
}

it("docks one composer under the diff on a line tap, with no modal, picker or title", async () => {
  const server = companion();
  const view = await renderChanges(server);

  await tapLine();

  const composer = view.getByTestId("review-line-composer");
  expect(within(composer).getByTestId("review-line-composer-anchor")).toHaveTextContent(
    "main.rs · line 4",
  );
  expect(within(composer).getByLabelText(`Comment on line 4 of ${PATH}`)).toBeOnTheScreen();
  expect(within(composer).getByTestId("native-editor")).toBeOnTheScreen();
  expect(within(composer).getByLabelText("Expand")).toBeOnTheScreen();
  expect(within(composer).getByLabelText("Close")).toBeOnTheScreen();
  // Nothing to send yet: the one trailing action is the microphone.
  expect(within(composer).getByLabelText("Voice input")).toBeOnTheScreen();
  expect(within(composer).queryByTestId("review-comment-send")).toBeNull();
  for (const removed of ["Send to", "Agent", "Both", "PR", "Add draft"]) {
    expect(within(composer).queryByText(removed)).toBeNull();
  }
  // No sheet or scrim covers the diff; it stays mounted and keeps taking line taps.
  expect(sheetRenders).toBe(0);
  expect(view.getByTestId("pull-request-diff")).toBeOnTheScreen();
  expect(view.getByTestId("review-dock-submit")).toBeOnTheScreen();
  expect(postedCommands().map(({ command }) => command)).not.toContain("composer");
  expect(highlighted()).toMatchObject({ line: 4, path: PATH, side: "new" });
});

it("keeps the docked composer above the open keyboard, less the navigation bar it covers", async () => {
  setKeyboardHeightForTest(600);
  try {
    const view = await renderChanges(companion(), { bottomInset: 48 });
    await tapLine();
    expect(view.getByTestId("keyboard-dock")).toHaveStyle({ paddingBottom: 552 });
  } finally {
    setKeyboardHeightForTest(0);
  }
});

it("morphs the microphone into Add to review once there is text", async () => {
  const server = companion();
  const view = await renderChanges(server);
  await tapLine();

  typeComment(view, "Rename this call");

  const composer = view.getByTestId("review-line-composer");
  expect(within(composer).queryByLabelText("Voice input")).toBeNull();
  const send = within(composer).getByTestId("review-comment-send");
  expect(send).toHaveAccessibleName("Add to review");
  expect(send).toBeEnabled();

  typeComment(view, "  ");
  expect(within(composer).getByLabelText("Voice input")).toBeOnTheScreen();
  expect(within(composer).queryByTestId("review-comment-send")).toBeNull();
});

it("re-anchors the open composer to another tapped line and keeps the typed text", async () => {
  const server = companion();
  const view = await renderChanges(server);
  await tapLine();
  typeComment(view, "Rename this call");
  const editor = within(view.getByTestId("review-line-composer")).getByTestId("native-editor");

  await tapLine(OTHER_LINE);

  // The same editor, now anchored to line 3, with the text the user typed.
  const composer = view.getByTestId("review-line-composer");
  expect(within(composer).getByTestId("native-editor")).toBe(editor);
  expect(within(composer).getByTestId("review-line-composer-anchor")).toHaveTextContent(
    "main.rs · line 3",
  );
  expect(editor).toHaveProp("defaultValue", "Rename this call");
  expect(highlighted()).toMatchObject({ line: 3, path: PATH, side: "new" });

  fireEvent.press(within(composer).getByTestId("review-comment-send"));
  await waitFor(() => {
    expect(server.puts).toHaveLength(1);
  });
  expect(server.puts[0]?.params.draft).toMatchObject({
    anchor: { path: PATH, side: "new", startLine: 3 },
    body: "Rename this call",
  });
});

it("expands to fill the pane and collapses with the same editor, text and anchor", async () => {
  const server = companion();
  const view = await renderChanges(server);
  await tapLine();
  typeComment(view, "A longer review comment");
  const editor = within(view.getByTestId("review-line-composer")).getByTestId("native-editor");

  fireEvent.press(within(view.getByTestId("review-line-composer")).getByLabelText("Expand"));

  expect(view.getByTestId("review-line-composer")).toHaveStyle({ flex: 1 });
  expect(
    within(view.getByTestId("review-line-composer")).getByLabelText("Collapse"),
  ).toBeOnTheScreen();
  expect(within(view.getByTestId("review-line-composer")).getByTestId("native-editor")).toBe(
    editor,
  );
  expect(editor).toHaveProp("defaultValue", "A longer review comment");
  expect(view.getByTestId("pull-request-diff")).toBeOnTheScreen();

  fireEvent.press(within(view.getByTestId("review-line-composer")).getByLabelText("Collapse"));

  const composer = view.getByTestId("review-line-composer");
  expect(composer).not.toHaveStyle({ flex: 1 });
  expect(within(composer).getByTestId("review-line-composer-anchor")).toHaveTextContent(
    "main.rs · line 4",
  );
  expect(within(composer).getByTestId("native-editor")).toBe(editor);
  expect(editor).toHaveProp("defaultValue", "A longer review comment");
});

it("keeps unsent text on its line after Close", async () => {
  const server = companion();
  const view = await renderChanges(server);
  await tapLine();
  typeComment(view, "Not yet");

  fireEvent.press(within(view.getByTestId("review-line-composer")).getByLabelText("Close"));

  expect(view.queryByTestId("review-line-composer")).toBeNull();
  await tapLine();
  expect(within(view.getByTestId("review-line-composer")).getByTestId("native-editor")).toHaveProp(
    "defaultValue",
    "Not yet",
  );
  expect(server.puts).toHaveLength(0);
});

it("closes at once on send and shows the PR draft while it is saved", async () => {
  const server = companion();
  const view = await renderChanges(server);
  await tapLine();
  typeComment(view, "Rename this call");

  fireEvent.press(view.getByTestId("review-comment-send"));

  // Closed at once, before the companion answered.
  expect(view.queryByTestId("review-line-composer")).toBeNull();
  await waitFor(() => {
    expect(server.puts).toHaveLength(1);
  });
  expect(server.puts[0]?.params.draft).toMatchObject({
    body: "Rename this call",
    destination: "pr",
  });
  expect(server.puts[0]?.params.draft).not.toHaveProperty("targetThreadId");
  await waitFor(() => {
    expect(inlineComments()).toEqual([
      expect.objectContaining({ body: "Rename this call", line: 4, state: "pending" }),
    ]);
  });
  expect(view.getByTestId("review-dock-submit")).toBeOnTheScreen();
  const toggle = view.getByTestId("pr-file-drafts-toggle");
  expect(toggle).toHaveTextContent("▸ 1 draft in this file");
  fireEvent.press(toggle);
  const draftId = String(server.puts[0]?.params.draft.id);
  expect(view.getByTestId(`review-draft-put-${draftId}`)).toHaveTextContent(/Rename this call/u);

  await act(async () => {
    server.puts[0]?.resolve();
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(view.getByTestId(`review-draft-${draftId}`)).toBeOnTheScreen();
  });
  expect(view.queryByTestId(`review-draft-put-${draftId}`)).toBeNull();
  expect(inlineComments()).toEqual([
    expect.objectContaining({ body: "Rename this call", id: draftId, state: "saved" }),
  ]);
  expect(view.getByTestId("review-dock-submit")).toBeOnTheScreen();
});

it("shows the companion's reason on a refused draft and Edit reopens the docked composer with its text", async () => {
  const server = companion();
  const view = await renderChanges(server);
  await tapLine();
  typeComment(view, "Rename this call");
  fireEvent.press(view.getByTestId("review-comment-send"));
  await waitFor(() => {
    expect(server.puts).toHaveLength(1);
  });
  const draftId = String(server.puts[0]?.params.draft.id);

  await act(async () => {
    server.puts[0]?.reject(new RpcResponseError(-32_088, "The line is outside the diff"));
    await Promise.resolve();
  });

  // A refusal unfolds the file's drafts with the real reason.
  const card = await view.findByTestId(`review-draft-put-${draftId}`);
  expect(card).toHaveTextContent(/The line is outside the diff/u);
  expect(view.getByTestId("pr-file-drafts-toggle")).toHaveTextContent(/1 not saved/u);
  expect(inlineComments()).toEqual([
    expect.objectContaining({
      body: "Rename this call",
      error: "The line is outside the diff",
      state: "failed",
    }),
  ]);

  fireEvent.press(within(card).getByText("Edit"));

  const composer = view.getByTestId("review-line-composer");
  expect(within(composer).getByTestId("review-line-composer-anchor")).toHaveTextContent(
    "main.rs · line 4",
  );
  expect(within(composer).getByTestId("native-editor")).toHaveProp(
    "defaultValue",
    "Rename this call",
  );
  await waitFor(() => {
    expect(view.queryByTestId(`review-draft-put-${draftId}`)).toBeNull();
  });
  expect(inlineComments()).toEqual([]);
  expect(view.getByTestId("review-comment-send")).toBeEnabled();
  expect(sheetRenders).toBe(0);
});
