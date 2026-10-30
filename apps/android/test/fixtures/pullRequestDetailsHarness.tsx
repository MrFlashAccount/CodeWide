/**
 * The PR Details render harness shared by the conversation and Status tests:
 * a fake companion answering the #91 reads, capability stubs, and a mounted
 * `PullRequestScreen` on the Details tab. Test files keep their own native
 * module mocks (`jest.mock` is hoisted per file).
 */
import { RpcResponseError } from "@codewide/sync-client";
import { act, render, within } from "@testing-library/react-native";
import { Suspense, type ReactNode } from "react";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { parsePullRequestKeyParam } from "../../src/data/forgeContract";
import { createForgeResources } from "../../src/data/forgeResources";
import { createPullRequestCommentDestinations } from "../../src/data/pullRequestCommentDestinations";
import { createReviewResources } from "../../src/data/reviewResources";
import { threadId } from "../../src/data/reviewContract";
import { PullRequestScreen } from "../../src/features/pullRequestDetail/PullRequestScreen";
import type { PullRequestDetailWorkspaceCapabilities } from "../../src/features/pullRequestDetail/workspaceCapabilities";
import type { ReviewTargetCapabilities } from "../../src/features/review/reviewTargetCapabilities";
import {
  connectedAccount,
  conversation91,
  githubConversationProvider,
  githubProvider,
  overview91,
} from "./forgeWireFixtures";
import { createMemoryQueryPersister } from "./queryPersister";

export const PULL_REQUEST = parsePullRequestKeyParam(overview91.pullRequest);
export const REVIEW_CHAT = threadId("thread-review-chat", "threadId");

export type Capabilities = PullRequestDetailWorkspaceCapabilities;

/** A companion that answers the PR reads until `goOffline` makes it unreachable. */
function companion({
  conversation,
  conversationDeclared,
  extraCapabilities,
  olderConversation,
}: {
  readonly conversation: unknown;
  readonly conversationDeclared: boolean;
  /** Further capabilities the PR's plugin declares. */
  readonly extraCapabilities: readonly string[];
  /** The page answered for a non-null cursor. */
  readonly olderConversation: unknown;
}) {
  const reads: string[] = [];
  let reachable = true;
  const answers: Readonly<Record<string, unknown>> = {
    "companion/forge/accounts/read": {
      accounts: [connectedAccount],
      flows: [],
      providers: [
        {
          ...(conversationDeclared ? githubConversationProvider : githubProvider),
          capabilities: [
            ...(conversationDeclared ? githubConversationProvider : githubProvider).capabilities,
            ...extraCapabilities,
          ],
        },
      ],
    },
    "companion/pullRequest/activity/read": overview91.activity,
    "companion/pullRequest/conversation/read": conversation,
    "companion/pullRequest/files/read": { files: [], headRevision: "head-1", nextCursor: null },
    "companion/pullRequest/read": overview91,
    "companion/review/drafts/read": { drafts: [] },
  };
  const cursors: unknown[] = [];
  const rpcAfterAttach = async <Result,>(
    _session: unknown,
    method: string,
    params?: unknown,
  ): Promise<Result> => {
    reads.push(method);
    await Promise.resolve();
    if (!reachable) {
      throw new Error("The companion is unreachable");
    }
    const cursor =
      typeof params === "object" && params !== null && "cursor" in params ? params.cursor : null;
    if (method === "companion/pullRequest/conversation/read" && cursor !== null) {
      cursors.push(cursor);
      // WHY: as below, a wire fixture the app's own parser validates.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return olderConversation as Result;
    }
    if (!(method in answers)) {
      throw new RpcResponseError(-32_601, `Unknown ${method}`);
    }
    // WHY: the fake transport returns wire fixtures; the app's own parsers validate them.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return answers[method] as Result;
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
    cursors,
    forge,
    goOffline: () => {
      reachable = false;
    },
    reads,
    review,
  };
}

function capabilities(overrides: Partial<Capabilities>): Capabilities {
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
    ...overrides,
  };
}

/** No chat is unread: the review chat badge is covered by its own test. */
function readNoChat(): boolean {
  return false;
}

/** Renders Details for #91 over a fake companion; `unmountScreens` disposes it. */
export function renderScreen({
  capabilityOverrides = {},
  conversation = conversation91,
  conversationDeclared = true,
  extraCapabilities = [],
  olderConversation = null,
  openChanges = jest.fn(),
  openThread = jest.fn(),
}: {
  readonly capabilityOverrides?: Partial<Capabilities>;
  readonly conversation?: unknown;
  readonly conversationDeclared?: boolean;
  readonly extraCapabilities?: readonly string[];
  readonly olderConversation?: unknown;
  readonly openChanges?: (view: "files" | "guide") => void;
  readonly openThread?: (id: string) => void;
}) {
  if (PULL_REQUEST === null) {
    throw new Error("the pull request key fixture must parse");
  }
  const server = companion({
    conversation,
    conversationDeclared,
    extraCapabilities,
    olderConversation,
  });
  const wrap = (children: ReactNode) => (
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 900, width: 420, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <Suspense fallback={<Text>Loading pull request</Text>}>{children}</Suspense>
    </SafeAreaProvider>
  );
  const view = render(
    wrap(
      <PullRequestScreen
        capabilities={capabilities(capabilityOverrides)}
        commentDestinations={createPullRequestCommentDestinations({
          deleteConnection: async () => undefined,
          read: async () => null,
          write: async () => undefined,
        })}
        connectionId="server"
        describeThread={() => null}
        forge={server.forge}
        isThreadUnread={readNoChat}
        navigation={{
          back: () => undefined,
          chatVisible: true,
          closeChanges: () => undefined,
          deferReviewChatScenario: async () => Promise.resolve(null),
          openPullRequestFullscreen: () => undefined,
          openReviewChat: () => undefined,
          openChanges,
          openThread,
          pullRequestFullscreen: false,
        }}
        pullRequest={PULL_REQUEST}
        review={server.review}
        // WHY: the Details tab never reaches the Changes review target; an empty owner suffices.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        reviewCapabilities={{} as ReviewTargetCapabilities}
        initialChangesView="files"
        tab="overview"
        tablet={false}
      />,
    ),
  );
  mounted.push({ clear: () => server.forge.queryClient.clear(), unmount: view.unmount });
  return { server, view };
}

/** Types into one reply input through the editor's native text and Markdown events. */
export function type(input: ReturnType<typeof within>, text: string): void {
  const editor = input.getByTestId("native-editor");
  act(() => {
    editor.props.onChangeText(text);
    editor.props.onChangeMarkdown(text);
  });
}

const mounted: { readonly clear: () => void; readonly unmount: () => void }[] = [];

/** Stops every mounted screen's queries and delivers TanStack's last batched notification inside act. */
export async function unmountScreens(): Promise<void> {
  await act(async () => {
    for (const screen of mounted.splice(0)) {
      screen.unmount();
      screen.clear();
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

/** Every element of a pressable or text tree, flattened to its visible text. */
export function textOf(node: Parameters<typeof within>[0]): string {
  return within(node)
    .queryAllByText(/.+/u)
    .map((child) => String(child.props.children))
    .join(" ");
}
