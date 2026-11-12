import { describe, expect, it, vi } from "vitest";

import { headRevision, parsePullRequestKeyParam } from "../src/data/forgeContract";
import {
  parseConversationPage,
  parseConversationWrite,
  parseThreadResolveWrite,
  type ConversationEntry,
  type ConversationPage,
  type ConversationReviewThread,
} from "../src/data/forgeConversationContract";
import { createForgeResources } from "../src/data/forgeResources";
import { createReviewResources } from "../src/data/reviewResources";
import type { WorkspaceSyncSession } from "../src/data/workspace-session";
import { createPullRequestDetailWorkspaceAdapter } from "../src/features/pullRequestDetail/workspaceAdapter";
import { conversation91, conversationComment } from "./fixtures/forgeWireFixtures";
import { createMemoryQueryPersister } from "./fixtures/queryPersister";

vi.mock("expo-crypto", () => ({ randomUUID: () => "generated-id" }));

function parsed(value: unknown): ConversationPage {
  const page = parseConversationPage(value);
  if (page === null) {
    throw new Error("the conversation fixture must parse");
  }
  return page;
}

function threads(page: ConversationPage) {
  return page.entries.flatMap((entry) => (entry.kind === "reviewThread" ? [entry.thread] : []));
}

/** The fixture's open thread `rt-1`, the one `withThread` changes. */
function threadRt1(page: ConversationPage): ConversationReviewThread | undefined {
  return threads(page).find((thread) => thread.id === "rt-1");
}

function openThread(): ConversationReviewThread {
  const thread = threadRt1(parsed(conversation91));
  if (thread === undefined) {
    throw new Error("the conversation fixture has an open thread");
  }
  return thread;
}

function bodyOf(params: unknown): string {
  return typeof params === "object" &&
    params !== null &&
    "body" in params &&
    typeof params.body === "string"
    ? params.body
    : "";
}

function paramsOf(params: unknown): Readonly<Record<string, unknown>> {
  return typeof params === "object" && params !== null ? { ...params } : {};
}

/** Replaces the first thread of the fixture with `thread` overrides. */
function withThread(overrides: Record<string, unknown>): unknown {
  return {
    ...conversation91,
    entries: conversation91.entries.map((entry) =>
      entry.kind === "reviewThread" && "thread" in entry && entry.thread.id === "rt-1"
        ? { ...entry, thread: { ...entry.thread, ...overrides } }
        : entry,
    ),
  };
}

const COMMIT = { authorLogin: null, sha: "a".repeat(40), shortSha: null, title: "t" };

describe("forge conversation contract", () => {
  it("keeps every entry kind in the forge's newest-first order", () => {
    const page = parsed(conversation91);
    expect(page.entries.map((entry: ConversationEntry) => entry.kind)).toEqual([
      "event",
      "reviewThread",
      "reviewThread",
      "review",
      "comment",
    ]);
    expect(page.nextCursor).toBeNull();
    const open = threadRt1(page);
    expect(open?.comments.map((comment) => comment.id)).toEqual(["c-2", "c-3", "c-4"]);
    expect(open?.comments[1]?.updatedAt).toBe("2026-10-21T09:22:00Z");
  });

  it("maps anchors, resolution, the review link and the outdated mark", () => {
    const [settled, open] = threads(parsed(conversation91));
    expect(open).toMatchObject({
      anchor: { kind: "line", line: 214, side: "new", startLine: null },
      outdated: false,
      resolution: { kind: "conversation", resolved: false },
      reviewId: "r-1",
    });
    expect(settled).toMatchObject({
      anchor: { kind: "file", path: "crates/companion-core/src/forge/reads.rs" },
      outdated: true,
      resolution: { kind: "conversation", resolved: true },
      reviewId: null,
    });
  });

  it.each([
    [{ kind: "pullRequest" }],
    [{ kind: "file", path: "a.rs" }],
    [{ kind: "line", line: 7, path: "a.rs", side: "old", startLine: 3 }],
    [{ kind: "line", line: 7, path: "a.rs", side: "new", startLine: null }],
  ])("keeps the anchor %j", (anchor) => {
    expect(threadRt1(parsed(withThread({ anchor })))?.anchor).toEqual(anchor);
  });

  it.each([
    [{ kind: "none" }],
    [{ kind: "conversation", resolved: true, viewerCanToggle: true }],
    [{ kind: "conversation", resolved: false, viewerCanToggle: false }],
    [{ changedAt: null, changedBy: null, kind: "issue", state: "open" }],
    [
      {
        changedAt: "2026-10-21T10:00:00Z",
        changedBy: { avatarDirect: false, avatarUrl: null, kind: "bot", login: "arc-robot" },
        kind: "issue",
        state: "resolved",
      },
    ],
    [{ changedAt: null, changedBy: null, kind: "issue", state: "dropped" }],
  ])("keeps the resolution %j", (resolution) => {
    expect(threadRt1(parsed(withThread({ resolution })))?.resolution).toEqual(resolution);
  });

  it("lets the viewer toggle a conversation only when the forge says so", () => {
    expect(
      threadRt1(parsed(withThread({ resolution: { kind: "conversation", resolved: false } })))
        ?.resolution,
    ).toEqual({ kind: "conversation", resolved: false, viewerCanToggle: false });
  });

  it("keeps a code excerpt line by line and treats a missing one as none", () => {
    const lines = [
      { kind: "context", newLine: 212, oldLine: 211, text: "fn read() {" },
      { kind: "removed", oldLine: 212, text: "    let stderr = Stdio::null();" },
      { kind: "added", newLine: 213, text: "    let stderr = Stdio::piped();" },
    ];
    expect(threadRt1(parsed(withThread({ excerpt: { lines } })))?.excerpt).toEqual({ lines });
    expect(threadRt1(parsed(withThread({ excerpt: null })))?.excerpt).toBeNull();
    expect(openThread().excerpt).toBeNull();
  });

  it("keeps a push's commits and treats a missing list as none", () => {
    const commits = {
      items: [
        { authorLogin: "dana", sha: "a".repeat(40), shortSha: "aaaaaaa", title: "Map stderr" },
        { authorLogin: null, sha: "b".repeat(40), shortSha: null, title: "Keep the hint" },
      ],
      total: 5,
    };
    const page = parsed({
      ...conversation91,
      entries: [{ ...conversation91.entries[0], commits }],
    });
    expect(page.entries[0]).toMatchObject({ commits, kind: "event" });
    const bare = parsed({
      ...conversation91,
      entries: [
        {
          ...conversation91.entries[0],
          commits: {
            items: [{ sha: "c".repeat(40), title: "Only the required fields" }],
            total: 1,
          },
        },
      ],
    });
    expect(bare.entries[0]).toMatchObject({
      commits: { items: [{ authorLogin: null, shortSha: null }], total: 1 },
    });
    expect(parsed(conversation91).entries[0]).toMatchObject({ commits: null, kind: "event" });
  });

  it("keeps the iteration, every author kind and the page's merge rule", () => {
    const page = parsed({
      ...withThread({
        comments: [
          conversationComment("c-ai", {
            author: { avatarUrl: null, kind: "ai", login: "assistant" },
          }),
          conversationComment("c-bot", { author: { avatarUrl: null, kind: "bot", login: "ci" } }),
        ],
        iteration: { id: "it-4", number: 4 },
      }),
      openIssuesBlockMerge: true,
    });
    const thread = threadRt1(page);
    expect(thread?.iteration).toEqual({ id: "it-4", number: 4 });
    expect(thread?.comments.map((comment) => comment.author.kind)).toEqual(["ai", "bot"]);
    expect(page.entries.at(-1)).toMatchObject({ comment: { author: { kind: "user" } } });
    expect(page.openIssuesBlockMerge).toBe(true);
    expect(parsed(conversation91).openIssuesBlockMerge).toBeNull();
  });

  it.each([
    "approved",
    "changesRequested",
    "commented",
    "dismissed",
    "mergeBlocked",
    "mergeUnblocked",
    "approvalWithdrawn",
  ])("keeps the verdict %s", (verdict) => {
    const page = parsed({
      ...conversation91,
      entries: [{ ...conversation91.entries[3], verdict }],
    });
    expect(page.entries[0]).toMatchObject({ kind: "review", verdict });
  });

  it.each(["push", "state", "ci", "other"])("keeps the event category %s", (category) => {
    const page = parsed({
      ...conversation91,
      entries: [{ ...conversation91.entries[0], category }],
    });
    expect(page.entries[0]).toMatchObject({ category, kind: "event" });
  });

  it("keeps the review's own body and verdict", () => {
    const review = parsed(conversation91).entries.find((entry) => entry.kind === "review");
    expect(review).toMatchObject({ kind: "review", verdict: "changesRequested" });
    expect(review?.kind === "review" ? review.body?.body : null).toBe(
      "Two small things inline; the mapping itself looks right.",
    );
  });

  it("drops reactions nobody holds any more", () => {
    const page = parsed(
      withThread({
        comments: [
          conversationComment("c-9", {
            reactions: [
              { content: "thumbsUp", count: 0, viewerReacted: false },
              { content: "heart", count: 2, viewerReacted: true },
            ],
          }),
        ],
      }),
    );
    expect(threadRt1(page)?.comments[0]?.reactions).toEqual([
      { content: "heart", count: 2, viewerReacted: true },
    ]);
  });

  it.each([
    ["a thread without comments", withThread({ comments: [] })],
    [
      "an unknown side",
      withThread({ anchor: { kind: "line", line: 3, path: "a", side: "both", startLine: null } }),
    ],
    [
      "line 0",
      withThread({ anchor: { kind: "line", line: 0, path: "a", side: "new", startLine: null } }),
    ],
    [
      "a range that does not end after it starts",
      withThread({ anchor: { kind: "line", line: 3, path: "a", side: "new", startLine: 3 } }),
    ],
    ["a file anchor without a path", withThread({ anchor: { kind: "file", path: "" } })],
    [
      "the retired flat location",
      withThread({ anchor: undefined, line: 3, path: "a", side: "new" }),
    ],
    ["the retired resolved flag", withThread({ resolution: undefined, resolved: true })],
    [
      "an unknown issue state",
      withThread({
        resolution: { changedAt: null, changedBy: null, kind: "issue", state: "closed" },
      }),
    ],
    ["iteration 0", withThread({ iteration: { id: "it-0", number: 0 } })],
    ["a missing review link", withThread({ reviewId: undefined })],
    [
      "an author without a kind",
      withThread({
        comments: [conversationComment("c-9", { author: { avatarUrl: null, login: "a" } })],
      }),
    ],
    [
      "an event without a category",
      { ...conversation91, entries: [{ ...conversation91.entries[0], category: undefined }] },
    ],
    ["an empty excerpt", withThread({ excerpt: { lines: [] } })],
    [
      "an excerpt of nine lines",
      withThread({
        excerpt: {
          lines: Array.from({ length: 9 }, (_, index) => ({
            kind: "added",
            newLine: index + 1,
            text: "x",
          })),
        },
      }),
    ],
    [
      "an added excerpt line without its new number",
      withThread({ excerpt: { lines: [{ kind: "added", oldLine: 3, text: "x" }] } }),
    ],
    [
      "an excerpt line spanning two lines",
      withThread({ excerpt: { lines: [{ kind: "removed", oldLine: 3, text: "a\nb" }] } }),
    ],
    [
      "a conversation toggle that is not a flag",
      withThread({ resolution: { kind: "conversation", resolved: false, viewerCanToggle: "yes" } }),
    ],
    [
      "push commits without items",
      {
        ...conversation91,
        entries: [{ ...conversation91.entries[0], commits: { items: [], total: 0 } }],
      },
    ],
    [
      "push commits with a total below the listed items",
      {
        ...conversation91,
        entries: [{ ...conversation91.entries[0], commits: { items: [COMMIT, COMMIT], total: 1 } }],
      },
    ],
    [
      "more than twenty push commits",
      {
        ...conversation91,
        entries: [
          {
            ...conversation91.entries[0],
            commits: { items: Array.from({ length: 21 }, () => COMMIT), total: 21 },
          },
        ],
      },
    ],
    ["a page without the merge rule", { ...conversation91, openIssuesBlockMerge: undefined }],
    [
      "an unknown reaction",
      withThread({
        comments: [
          conversationComment("c-9", {
            reactions: [{ content: "party", count: 1, viewerReacted: false }],
          }),
        ],
      }),
    ],
    [
      "an unknown entry kind",
      { entries: [{ id: "x", kind: "label" }], nextCursor: null, openIssuesBlockMerge: null },
    ],
    [
      "an unknown verdict",
      {
        entries: [
          {
            author: { avatarUrl: null, kind: "user", login: "a" },
            body: null,
            createdAt: "2026-10-21T09:05:00Z",
            id: "r",
            kind: "review",
            verdict: "lgtm",
          },
        ],
        nextCursor: null,
        openIssuesBlockMerge: null,
      },
    ],
    [
      "a comment without an author login",
      {
        entries: [
          {
            comment: conversationComment("c", { author: { avatarUrl: null, kind: "user" } }),
            kind: "comment",
          },
        ],
        nextCursor: null,
        openIssuesBlockMerge: null,
      },
    ],
  ])("rejects a page with %s", (_name, value) => {
    expect(parseConversationPage(value)).toBeNull();
  });

  it("parses an acknowledged write and rejects one without a comment", () => {
    expect(
      parseConversationWrite({ comment: conversationComment("c-10", { body: "Done" }) }),
    ).toMatchObject({
      body: "Done",
      id: "c-10",
    });
    expect(parseConversationWrite({})).toBeNull();
  });

  it("parses an acknowledged resolution and rejects one without its state", () => {
    expect(parseThreadResolveWrite({ resolved: true, viewerCanToggle: false })).toEqual({
      resolved: true,
      viewerCanToggle: false,
    });
    expect(parseThreadResolveWrite({ resolved: true })).toBeNull();
  });
});

function sessionFixture(): WorkspaceSyncSession {
  const value = { connectionId: "server", rpc: vi.fn(), stop: vi.fn() };
  // WHY: RpcClient is an external concrete class; this adapter test injects RPC and consumes
  // only the session identity required to select the connected Companion.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as WorkspaceSyncSession;
}

function adapterFixture(respond: (method: string, params: unknown) => unknown) {
  const calls: { readonly method: string; readonly params: unknown }[] = [];
  const session = sessionFixture();
  const rpcAfterAttach = async <Result>(
    _session: unknown,
    method: string,
    params: unknown,
  ): Promise<Result> => {
    calls.push({ method, params });
    // WHY: this typed test transport must implement the caller-selected generic RPC result;
    // the production adapter validates every unknown response before returning it.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return respond(method, params) as Result;
  };
  const forge = createForgeResources({
    getSession: () => session,
    persister: createMemoryQueryPersister().persister,
    reportDroppedAction: () => undefined,
    rpcAfterAttach,
  });
  const adapter = createPullRequestDetailWorkspaceAdapter({
    forge,
    reportDroppedAction: () => undefined,
    review: createReviewResources({
      getSession: () => session,
      queryClient: forge.queryClient,
      rpcAfterAttach,
    }),
    transferAccess: async () => Promise.reject(new Error("unused")),
  });
  const pullRequest = parsePullRequestKeyParam("fpr1.github-91");
  if (pullRequest === null) {
    throw new Error("the pull request key fixture must parse");
  }
  return { adapter, calls, forge, target: { connectionId: "server", pullRequest } };
}

describe("pull request conversation writes", () => {
  it("replies once with the thread id and key, then shows the reply in its thread", async () => {
    const { adapter, calls, forge, target } = adapterFixture((method, params) => {
      if (method === "companion/pullRequest/reviewThread/reply") {
        return { comment: conversationComment("c-new", { body: bodyOf(params) }) };
      }
      throw new Error(`Unexpected RPC: ${method}`);
    });
    forge.conversation.publish(target, parsed(conversation91));
    const threadId = openThread().id;

    const reply = await adapter.replyToReviewThread(target, {
      body: "On it",
      idempotencyKey: "key-1",
      threadId,
    });

    expect(reply.id).toBe("c-new");
    expect(calls.filter((call) => call.method.endsWith("/reply"))).toEqual([
      {
        method: "companion/pullRequest/reviewThread/reply",
        params: {
          body: "On it",
          idempotencyKey: "key-1",
          pullRequest: target.pullRequest,
          threadId,
        },
      },
    ]);
    const shown = forge.conversation.data(target);
    expect(shown === null ? [] : threadRt1(shown)?.comments.map((comment) => comment.body)).toEqual(
      [
        "stderr is discarded here, so an expired token surfaces as a timeout.",
        "Good catch. Should `AuthRequired` carry the host's hint?",
        "Yes, keep the hint; the Accounts sheet already shows it.",
        "On it",
      ],
    );
  });

  it("puts a top-level comment above the newest entry, even with older pages left", async () => {
    const { adapter, calls, forge, target } = adapterFixture((method) => {
      if (method === "companion/pullRequest/comment/create") {
        return { comment: conversationComment("c-top", { body: "Ship it" }) };
      }
      throw new Error(`Unexpected RPC: ${method}`);
    });
    forge.conversation.publish(target, { ...parsed(conversation91), nextCursor: "older" });

    await adapter.createComment(target, { body: "Ship it", idempotencyKey: "key-2" });

    expect(calls.find((call) => call.method.endsWith("/create"))?.params).toEqual({
      body: "Ship it",
      idempotencyKey: "key-2",
      pullRequest: target.pullRequest,
    });
    const entries = forge.conversation.data(target)?.entries ?? [];
    expect(entries[0]).toMatchObject({ comment: { body: "Ship it" }, kind: "comment" });
    expect(entries).toHaveLength(conversation91.entries.length + 1);
    // A read that already holds the acknowledged comment is not patched twice.
    await adapter.createComment(target, { body: "Ship it", idempotencyKey: "key-2" });
    expect(forge.conversation.data(target)?.entries).toHaveLength(
      conversation91.entries.length + 1,
    );
  });

  it("resolves a conversation and shows the forge's resolution on its thread", async () => {
    const { adapter, calls, forge, target } = adapterFixture((method) => {
      if (method === "companion/pullRequest/reviewThread/resolve") {
        return { resolved: true, viewerCanToggle: true };
      }
      throw new Error(`Unexpected RPC: ${method}`);
    });
    forge.conversation.publish(target, parsed(conversation91));
    const threadId = openThread().id;

    const result = await adapter.resolveReviewThread(target, {
      idempotencyKey: "key-3",
      resolved: true,
      threadId,
    });

    expect(result).toEqual({ resolved: true, viewerCanToggle: true });
    expect(calls.find((call) => call.method.endsWith("/resolve"))?.params).toEqual({
      idempotencyKey: "key-3",
      pullRequest: target.pullRequest,
      resolved: true,
      threadId,
    });
    const shown = forge.conversation.data(target);
    expect(shown === null ? null : threadRt1(shown)?.resolution).toEqual({
      kind: "conversation",
      resolved: true,
      viewerCanToggle: true,
    });
  });

  it("names the review thread only for a focused scenario start", async () => {
    const { adapter, calls, target } = adapterFixture((method) => {
      if (method === "companion/pullRequest/scenario/start") {
        return { created: false, kind: "started", threadId: "thread-review-chat" };
      }
      throw new Error(`Unexpected RPC: ${method}`);
    });
    const request = {
      checkId: null,
      scenario: "addressComments",
      target: { kind: "reviewChat", workspace: { kind: "ask" } },
      text: null,
    } as const;
    const withHead = { ...target, headRevision: headRevision("head-1", "headRevision") };

    await adapter.startScenario(withHead, {
      ...request,
      idempotencyKey: "k-a",
      reviewThreadId: null,
    });
    await adapter.startScenario(withHead, {
      ...request,
      idempotencyKey: "k-b",
      reviewThreadId: openThread().id,
    });

    const params = calls.map((call) => paramsOf(call.params));
    expect(params.map((entry) => "reviewThreadId" in entry)).toEqual([false, true]);
    expect(params[1]?.reviewThreadId).toBe("rt-1");
  });
});
