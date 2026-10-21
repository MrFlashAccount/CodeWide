/**
 * Fake companion of the Pull requests browser preview. It answers every forge
 * and review method with the wire-contract fixtures for the scenario chosen by
 * the page, records writes, and builds the real data resources over it. Only
 * the transport is fake; parsing, caching and invalidation are the app's own.
 */
import { RpcResponseError, type RpcClient } from "@codewide/sync-client";

import { createForgeResources } from "../../src/data/forgeResources";
import type { ForgeSnapshotCache } from "../../src/data/forgeSnapshotCache.types";
import { createPullRequestCommentDestinations } from "../../src/data/pullRequestCommentDestinations";
import { createPullRequestLinkResources } from "../../src/data/pullRequestLinkResources";
import { createReviewResources } from "../../src/data/reviewResources";
import {
  arcanumProvider,
  connectedAccount,
  draftsSnapshot,
  expiredAccount,
  failedFlow,
  filesPage,
  githubProvider,
  guideState,
  hostLoginFlow,
  onboardingAccounts,
  overview91,
  reviewRequestedPage,
} from "./forgeWireFixtures";

type Answer = { readonly error: RpcResponseError } | { readonly result: unknown };

declare global {
  interface Window {
    previewScenario?: string;
    previewWrites?: string[];
  }
}

/** Scenario chosen by the test page before the bundle runs. */
export const scenario = window.previewScenario ?? "list";
window.previewWrites = [];

/** An account whose plugin call failed, for the Accounts sheet's error row. */
const erroredAccount = {
  ...connectedAccount,
  account: "github:ghe.example.com:sergeigarin",
  host: "ghe.example.com",
  reason: "The host refused the stored token",
  state: "error",
};

/** Every linked account comes with its provider, so each section shows that provider's own mark. */
const connectedSnapshot = {
  accounts: [connectedAccount, expiredAccount],
  flows: [],
  providers: [githubProvider, arcanumProvider],
};

function accountsAnswer(): Answer {
  const snapshots: Readonly<Record<string, unknown>> = {
    accounts: { accounts: [connectedAccount, expiredAccount, erroredAccount], flows: [], providers: [githubProvider, arcanumProvider] },
    onboarding: onboardingAccounts,
    "onboarding-connecting": onboardingAccounts,
    "onboarding-failed": { ...onboardingAccounts, flows: [failedFlow] },
    "onboarding-flow": { ...onboardingAccounts, flows: [hostLoginFlow] },
  };
  if (scenario === "companion-old") {
    return { error: new RpcResponseError(-32_601, "Method not found") };
  }
  return { result: snapshots[scenario] ?? connectedSnapshot };
}

/** Overview variants for the degraded and conflict frames. */
function overviewFor(name: string): unknown {
  if (name === "conflict") {
    // The plugin reports Update branch as impossible when the server cannot resolve the conflict.
    const actions = overview91.catalog.actions.map((entry) =>
      entry.actionId === "update"
        ? { ...entry, availability: { reason: "The server cannot update a conflicting branch", state: "disabled" } }
        : entry,
    );
    return {
      ...overview91,
      catalog: { ...overview91.catalog, actions },
      merge: { reason: "3 files · server update not possible", state: "conflicts" },
    };
  }
  if (name === "checks-unavailable") {
    return {
      ...overview91,
      checkItems: [],
      checks: { reason: "No Arc CI token on the companion host. Diffs, comments and review still work.", state: "unavailable" },
    };
  }
  return overview91;
}

/**
 * After an acknowledged Submit the companion keeps published drafts read-only:
 * the PR halves are published, the Both draft's agent half is sent, and the
 * agent-only draft stays pending.
 */
let submitted = false;
const [prOnly, both, agentOnly] = draftsSnapshot.drafts;
const submittedDrafts = {
  ...draftsSnapshot,
  drafts: [
    { ...prOnly, pr: { state: "published" } },
    { ...both, agent: { state: "sent", targetThreadId: "thread-forge-auth" }, pr: { state: "published" } },
    agentOnly,
  ],
};

const submitOutcome = {
  drafts: [
    { agent: "notRequested", draftId: "d1", error: null, pr: "published" },
    { agent: "sent", draftId: "d2", error: null, pr: "published" },
  ],
  reviewUrl: "https://github.com/acme/codewide/pull/91#pullrequestreview-1",
  runId: "run-submit-1",
};

const threadLinks = {
  threads: [
    {
      pullRequests: [{ icon: githubProvider.icon, number: "91", pullRequest: overview91.pullRequest, state: "open" }],
      threadId: "thread-forge-auth",
    },
    {
      pullRequests: [
        { icon: arcanumProvider.icon, number: "4120", pullRequest: "fpr1.arcanum-4120", state: "open" },
        { icon: githubProvider.icon, number: "88", pullRequest: "fpr1.github-88", state: "draft" },
      ],
      threadId: "thread-arc-review",
    },
  ],
};

/** Without a linked account the list has no sections; an older companion lacks the method. */
function listAnswer(): Answer {
  if (scenario === "companion-old") {
    return { error: new RpcResponseError(-32_601, "Method not found") };
  }
  return { result: scenario.startsWith("onboarding") ? { ...reviewRequestedPage, sections: [] } : reviewRequestedPage };
}

function submitAnswer(): Answer {
  if (scenario !== "submit-ok") {
    return { error: new RpcResponseError(-32_082, "Head moved to 9d01aa3; nothing was written") };
  }
  submitted = true;
  return { result: submitOutcome };
}

function answer(method: string): Answer | null {
  const answers: Readonly<Record<string, () => Answer | null>> = {
    "companion/forge/accounts/read": accountsAnswer,
    // A host login that has not answered yet keeps the card in its connecting state.
    "companion/forge/auth/start": () => null,
    "companion/pullRequest/action/run": () => ({
      error: new RpcResponseError(-32_082, "Head moved to 9d01aa3; nothing was written"),
    }),
    "companion/pullRequest/files/read": () => ({ result: filesPage }),
    "companion/pullRequest/read": () => ({ result: overviewFor(scenario) }),
    "companion/pullRequest/review/submit": submitAnswer,
    "companion/pullRequestLinks/read": () => ({ result: threadLinks }),
    "companion/pullRequests/list": listAnswer,
    "companion/review/drafts/read": () => ({ result: submitted ? submittedDrafts : draftsSnapshot }),
    "companion/review/guide/read": () => ({ result: guideState }),
  };
  if (scenario === "offline" && !method.endsWith("accounts/read")) {
    throw new Error("The companion is unreachable");
  }
  const reply = answers[method];
  return reply === undefined ? { error: new RpcResponseError(-32_601, `Unknown ${method}`) } : reply();
}

const NEVER = new Promise<never>(() => undefined);

async function fakeRpc<T>(_session: RpcClient, method: string, params: unknown): Promise<T> {
  await Promise.resolve();
  if (/\/(run|submit|set|start)$/u.test(method)) {
    window.previewWrites?.push(`${method} ${JSON.stringify(params)}`);
  }
  const reply = answer(method);
  if (reply === null) {
    return NEVER;
  }
  if ("error" in reply) {
    throw reply.error;
  }
  // WHY: the preview transport returns contract fixtures; callers validate them with the real parsers.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return reply.result as T;
}

// WHY: the fake session is only a handle passed back to fakeRpc; nothing calls its methods.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const session = { connectionId: undefined, rpc: fakeRpc } as unknown as RpcClient & { stop: () => void };
const memory = new Map<string, unknown>();
const snapshots: ForgeSnapshotCache = {
  deleteConnection: async () => undefined,
  read: async (_connection, key) => memory.get(key) ?? null,
  write: async (_connection, key, value) => {
    memory.set(key, value);
  },
};
if (scenario === "offline") {
  memory.set("list\u0000reviewRequested\u0000", { ...reviewRequestedPage, fetchedAt: new Date(Date.now() - 12 * 60_000).toISOString() });
}

/** Session authority over the fake transport. */
export const authority = { getSession: () => session, rpcAfterAttach: fakeRpc };
export const forgeResources = createForgeResources({ ...authority, reportDroppedAction: () => undefined, snapshots });
export const reviewResources = createReviewResources(authority);
export const pullRequestLinkResources = createPullRequestLinkResources(authority);
export const pullRequestCommentDestinations = createPullRequestCommentDestinations(snapshots);
