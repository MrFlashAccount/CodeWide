/**
 * Wire fixtures written from the approved companion forge/review contract
 * (architecture Canvas, "Companion wire contract"), not from backend output.
 * They model what a conforming companion sends; tests and rendered previews share them.
 */

/** A plugin-supplied full-colour image icon: a 1x1 PNG, standard base64. */
export const GITHUB_ICON_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const GITHUB_ICON = { dataBase64: GITHUB_ICON_PNG, kind: "image", mimeType: "image/png" };

/** A GitHub provider with the three account methods and a checks-free credential. */
export const githubProvider = {
  authMethods: [
    {
      available: true,
      detail: "Uses a gh login that already exists on the companion host.",
      disconnectModes: ["unlink", "logoutHost"],
      existingLogins: ["sergeigarin"],
      kind: "linkExisting",
      label: "Link a gh login",
      links: [],
      methodId: "gh-link",
      purpose: "account",
      requiredPermissions: [],
      unavailableReason: null,
    },
    {
      available: true,
      detail: "Runs gh auth login on the companion host.",
      disconnectModes: ["unlink", "logoutHost"],
      existingLogins: [],
      kind: "hostLogin",
      label: "Sign in with GitHub",
      links: [],
      methodId: "gh-login",
      purpose: "account",
      requiredPermissions: [],
      unavailableReason: null,
    },
    {
      available: true,
      detail:
        "Use this when gh is not on the host or you prefer not to use it. A classic token needs repo and read:org; repo grants full repository access. A fine-grained token sees only the selected repositories, and an organization may have to approve it.",
      disconnectModes: ["forgetToken"],
      existingLogins: [],
      kind: "pasteToken",
      label: "Paste a token",
      links: [
        {
          label: "Generate token",
          url: "https://github.com/settings/tokens/new?scopes=repo,read:org&description=CodeWide",
        },
        {
          label: "Fine-grained token",
          url: "https://github.com/settings/personal-access-tokens/new",
        },
      ],
      methodId: "gh-token",
      purpose: "account",
      requiredPermissions: [
        "Pull requests: read and write",
        "Contents: read",
        "Checks: read",
        "Commit statuses: read",
        "Metadata: read",
      ],
      unavailableReason: null,
    },
  ],
  builtIn: true,
  capabilities: [
    "forge.auth@1",
    "forge.list@1",
    "forge.search@1",
    "forge.read@1",
    "forge.diff@1",
    "forge.actions@1",
    "forge.review@1",
    "forge.checks@1",
    "forge.viewed@1",
  ],
  checksCredential: { state: "notApplicable" },
  defaultHost: "github.com",
  enabled: true,
  forgeName: "GitHub",
  icon: GITHUB_ICON,
  pluginId: "github",
};

/** A plugin-declared monochrome glyph (an open "A"), drawn as one path. */
export const ARCANUM_GLYPH = "M12 3L21 20H17.4L12 9.6L6.6 20H3Z";

/** An external provider with a monochrome plugin glyph whose checks need a second credential. */
export const arcanumProvider = {
  authMethods: [
    {
      available: false,
      detail: "Run arc token show on the companion host, then tap Check again.",
      disconnectModes: ["unlink"],
      existingLogins: [],
      kind: "instructions",
      label: "Get an arc token on the host",
      links: [],
      methodId: "arc-instructions",
      purpose: "account",
      requiredPermissions: [],
      unavailableReason: "No arc token found",
    },
  ],
  builtIn: false,
  capabilities: [
    "forge.auth@1",
    "forge.list@1",
    "forge.search@1",
    "forge.read@1",
    "forge.diff@1",
    "forge.actions@1",
    "forge.review@1",
  ],
  checksCredential: { state: "missing" },
  defaultHost: "a.yandex-team.ru",
  enabled: true,
  forgeName: "Arcanum",
  icon: { kind: "glyph", path: ARCANUM_GLYPH, viewBox: "0 0 24 24" },
  pluginId: "arcanum",
};

/** Linked account in each derived state. */
export const connectedAccount = {
  account: "github:github.com:sergeigarin",
  credentialSource: "ghCli",
  host: "github.com",
  linkedAt: "2026-10-20T08:00:00Z",
  login: "sergeigarin",
  pluginId: "github",
  scopes: ["repo", "read:org", "gist"],
  state: "connected",
};
export const expiredAccount = {
  ...connectedAccount,
  account: "arcanum:a.yandex-team.ru:sergeigarin",
  credentialSource: "arcToken",
  hint: "Run arc token show on the companion host",
  host: "a.yandex-team.ru",
  pluginId: "arcanum",
  scopes: null,
  state: "expired",
};

/** A live GitHub host-login flow: a one-time code, never a token. */
export const hostLoginFlow = {
  expiresAt: "2026-10-21T10:15:00Z",
  flowId: "flow-1",
  host: "github.com",
  methodId: "gh-login",
  pluginId: "github",
  state: "awaitingUser",
  userCode: "ABCD-1234",
  verificationUri: "https://github.com/login/device",
};

/** A host login whose `gh` process exited after showing the code. */
export const failedFlow = {
  flowId: "flow-2",
  host: "github.com",
  methodId: "gh-login",
  pluginId: "github",
  reason: "gh exited before the sign-in finished.",
  expiresAt: "2026-10-21T10:15:00Z",
  retryable: true,
  state: "failed",
};

/** `companion/forge/accounts/read` with no linked account (onboarding). */
export const onboardingAccounts = {
  accounts: [],
  flows: [],
  providers: [githubProvider, arcanumProvider],
};

const passing = { failing: 0, passed: 6, pending: 0, state: "passing" };
const newAttention = { revision: "a".repeat(64), state: "new" };

/** One list row. */
export function listRow(
  number: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    account: connectedAccount.account,
    author: "dana-r",
    checks: passing,
    linkedThreadCount: 0,
    localCheckout: false,
    number,
    pullRequest: `fpr1.github-${number}`,
    repository: "MrFlashAccount/CodeWide",
    reviewRequestedFromMe: true,
    reviewThreadId: null,
    state: "open",
    title: `Pull request ${number}`,
    updatedAt: "2026-10-21T09:00:00Z",
    webUrl: `https://github.com/MrFlashAccount/CodeWide/pull/${number}`,
    attention: newAttention,
    ...overrides,
  };
}

/** `companion/pullRequests/list` with a connected and an expired account section. */
export const reviewRequestedPage = {
  category: "reviewRequested",
  fetchedAt: "2026-10-21T09:48:00Z",
  nextCursor: null,
  repositories: ["MrFlashAccount/CodeWide"],
  sections: [
    {
      account: connectedAccount,
      rows: [
        listRow("91", {
          checks: { failing: 1, passed: 6, pending: 0, state: "failing" },
          linkedThreadCount: 2,
          localCheckout: true,
          title: "Route forge auth errors to an auth-required state",
        }),
        listRow("88", { author: "mikhail-p", title: "Add GitLab draft-notes publishing" }),
      ],
      supportedCategories: [
        "involved",
        "reviewRequested",
        "authored",
        "assigned",
        "mentioned",
        "drafts",
      ],
    },
    { account: expiredAccount, rows: [], supportedCategories: ["reviewRequested", "authored"] },
  ],
};

/** Default personal inbox returned for the provider-neutral involved category. */
export const involvedPage = { ...reviewRequestedPage, category: "involved" };

/** One catalog descriptor with contract defaults. */
export function action(
  actionId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    actionId,
    anchor: null,
    availability: { state: "enabled" },
    confirm: "none",
    group: actionId,
    input: null,
    isDefault: false,
    kind: "extension",
    label: actionId,
    order: 0,
    placement: "secondary",
    toggle: null,
    ...overrides,
  };
}

/** Overview of PR #91: blocked merge, one failing check, two links, a GitHub catalog. */
export const overview91 = {
  account: connectedAccount,
  attention: newAttention,
  activity: {
    items: [
      {
        author: "mikhail-p",
        body: "stderr is discarded here, so an expired token surfaces as a timeout.",
        createdAt: "2026-10-21T09:10:00Z",
        id: "a1",
        kind: "comment",
        line: 214,
        path: "crates/companion-core/src/vcs/plugin.rs",
        reviewThreadId: "rt-1",
        verdictLabel: null,
      },
    ],
    nextCursor: null,
  },
  author: "dana-r",
  baseBranch: "main",
  catalog: {
    actions: [
      action("review", { kind: "reviewPr", label: "Review PR", order: 1, placement: "primary" }),
      action("update", {
        confirm: "confirm",
        kind: "updateBranch",
        label: "Update branch",
        order: 2,
      }),
      action("address", { kind: "addressComments", label: "Address comments", order: 3 }),
      action("merge", {
        confirm: "none",
        input: {
          label: "Method",
          options: [
            { label: "Squash and merge", value: "squash" },
            { label: "Create a merge commit", value: "merge" },
          ],
          type: "enum",
        },
        kind: "merge",
        label: "Merge",
        order: 4,
      }),
      action("auto", {
        kind: "autoMerge",
        label: "Auto-merge when checks pass",
        order: 5,
        toggle: { on: false },
      }),
      action("fix", {
        anchor: { checkId: "c-android", kind: "checks" },
        kind: "fixCi",
        label: "Fix in agent",
        order: 6,
      }),
      action("approve", {
        group: "verdict",
        isDefault: true,
        kind: "verdict",
        label: "Approve",
        order: 7,
      }),
      action("request", { group: "verdict", kind: "verdict", label: "Request changes", order: 8 }),
      action("comment", { group: "verdict", kind: "verdict", label: "Comment", order: 9 }),
      action("close", {
        kind: "close",
        label: "Close pull request",
        order: 10,
        placement: "overflow",
      }),
    ],
    headRevision: "3fa9e12",
  },
  checkItems: [
    {
      checkId: "c-android",
      detailsUrl: null,
      durationSeconds: 192,
      name: "android / validate:android:v1",
      state: "failed",
    },
    {
      checkId: "c-companion",
      detailsUrl: null,
      durationSeconds: 300,
      name: "companion",
      state: "passed",
    },
    {
      checkId: "c-clippy",
      detailsUrl: null,
      durationSeconds: 120,
      name: "clippy",
      state: "passed",
    },
  ],
  checks: { failing: 1, passed: 6, pending: 0, state: "failing" },
  description:
    'Plugins now keep stderr and map forge "token expired" output to an auth-required state.',
  fetchedAt: "2026-10-21T09:48:00Z",
  headBranch: "feat/forge-auth-state-and-error-envelope",
  headRevision: "3fa9e12",
  links: [
    { source: "branch", threadId: "thread-forge-auth" },
    { source: "manual", threadId: "thread-review-91" },
  ],
  localCheckout: {
    branch: "feat/forge-auth-state-and-error-envelope",
    workspace: "/home/dev/CodeWide",
  },
  merge: { reason: "1 required check is failing", state: "blocked" },
  number: "91",
  pullRequest: "fpr1.github-91",
  repository: "MrFlashAccount/CodeWide",
  state: "open",
  stats: { additions: 412, deletions: 88, files: 14 },
  title: "Route forge auth errors to an auth-required state",
  webUrl: "https://github.com/MrFlashAccount/CodeWide/pull/91",
};

const PATCH = [
  "@@ -208,6 +208,8 @@ fn read_frame(&mut self)",
  " let header = self.read_header()?;",
  "-    .stderr(Stdio::null())",
  "+    .stderr(Stdio::piped())",
  "+if let Some(code) = auth_required(&stderr) {",
  "+    return Err(ForgeError::AuthRequired { host });",
  " let body = self.read_body(header.len)?;",
].join("\n");

/** `companion/pullRequest/files/read`, truncated by the forge, with every patch state. */
export const filesPage = {
  files: [
    {
      additions: 46,
      deletions: 9,
      patch: {
        hunks: [
          {
            fingerprint: "b3:aa",
            id: "crates/companion-core/src/vcs/plugin.rs#h1",
            newLines: 8,
            newStart: 208,
            oldLines: 6,
            oldStart: 208,
            ordinal: 1,
          },
        ],
        state: "present",
        text: PATCH,
      },
      path: "crates/companion-core/src/vcs/plugin.rs",
      previousPath: null,
      status: "modified",
      viewed: { source: "forge", viewed: true },
    },
    {
      additions: 128,
      deletions: 0,
      patch: { bytes: 2_202_009, state: "tooLarge" },
      path: "crates/companion-core/src/forge/auth_state.rs",
      previousPath: null,
      status: "added",
      viewed: { source: "forge", viewed: false },
    },
    {
      additions: 0,
      deletions: 0,
      patch: { state: "notProvided" },
      path: "assets/browser-devtools/front_end.bundle.js",
      previousPath: null,
      status: "modified",
      viewed: { source: "companion", viewed: false },
    },
  ],
  headRevision: "3fa9e12",
  nextCursor: null,
  truncated: { shown: 300, total: 1284 },
};

const prSource = { kind: "pullRequest", pullRequest: "fpr1.github-91" };

/** One companion draft on PR #91. */
export function prDraft(id: string, overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    anchor: {
      endLine: 210,
      hunk: null,
      path: "crates/companion-core/src/vcs/plugin.rs",
      side: "new",
      startLine: 210,
    },
    author: { kind: "user" },
    body: "Should the host name be redacted before it reaches the error message?",
    createdAt: "2026-10-21T09:30:00Z",
    id,
    revision: { revision: "3fa9e12", source: prSource },
    updatedAt: "2026-10-21T09:30:00Z",
    version: 1,
    ...overrides,
  };
}

/** `companion/review/drafts/read`: a PR draft, a Both draft and an agent-only draft. */
export const draftsSnapshot = {
  drafts: [
    prDraft("d1", { destination: "pr", pr: { state: "pending" }, sourceKind: "pullRequest" }),
    prDraft("d2", {
      agent: { state: "pending", targetThreadId: "thread-forge-auth" },
      body: "Rename to AuthRequired everywhere, the UI copy depends on it.",
      destination: "both",
      pr: { state: "pending" },
      sourceKind: "pullRequest",
    }),
    prDraft("d3", {
      agent: { state: "pending", targetThreadId: "thread-forge-auth" },
      body: "Add a test for the glab 401 Unauthorized line.",
      destination: "agent",
      sourceKind: "pullRequest",
    }),
  ],
  revision: "3fa9e12",
};

/** `companion/review/guide/read` with a valid guide, one accepted and one changed stop. */
export const guideState = {
  currentRevision: "3fa9e12",
  guide: {
    authorThreadId: "thread-forge-auth",
    chapters: [
      {
        chapterId: "ch-1",
        stops: [
          {
            hunkIds: ["crates/companion-core/src/vcs/plugin.rs#h1"],
            prose: "The plugin now keeps stderr.",
            stopId: "s1",
            summary: "Keep stderr",
            title: "Keep stderr",
          },
          {
            hunkIds: ["crates/companion-core/src/vcs/plugin.rs#h1"],
            prose: null,
            stopId: "s2",
            summary: "Map token expiry",
            title: "Map token expiry",
          },
        ],
        summary: null,
        title: "Error mapping",
      },
    ],
    createdAt: "2026-10-21T08:00:00Z",
    guideId: "g1",
    revision: "3fa9e12",
    source: prSource,
    summary: "Auth errors become a typed state.",
    support: ["crates/companion-core/src/forge/auth_state.rs#h1"],
    title: "Forge auth state",
  },
  lastError: null,
  pending: null,
  progress: [
    { state: "accepted", stopId: "s1" },
    { state: "changed", stopId: "s2" },
  ],
};

/** Capabilities a plugin declares for the PR conversation and its writes. */
export const CONVERSATION_CAPABILITIES = ["forge.conversation@1", "forge.comments@1"] as const;

/** The GitHub provider of a plugin that also declares the conversation and comment writes. */
export const githubConversationProvider = {
  ...githubProvider,
  capabilities: [...githubProvider.capabilities, ...CONVERSATION_CAPABILITIES],
};

const DANA = {
  avatarUrl: "https://avatars.githubusercontent.com/u/1001?v=4",
  kind: "user",
  login: "dana-r",
};
const MIKHAIL = { avatarUrl: null, kind: "user", login: "mikhail-p" };
const VIEWER = {
  avatarUrl: "https://avatars.githubusercontent.com/u/1003?v=4",
  kind: "user",
  login: "sergeigarin",
};

/** A forge-hosted image in a comment body; the companion fetches it through `forge.media.read`. */
export const FORGE_IMAGE_URL =
  "https://github.com/user-attachments/assets/5f4e1a2b-0000-4000-8000-00000000c0de";

/** One wire comment; `overrides` replaces any field. */
export function conversationComment(
  id: string,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    author: MIKHAIL,
    body: "",
    createdAt: "2026-10-21T09:00:00Z",
    id,
    reactions: [],
    updatedAt: null,
    url: `https://github.com/acme/codewide/pull/91#discussion_${id}`,
    ...overrides,
  };
}

/**
 * The #91 conversation, oldest first: a comment with an image and Mermaid, a
 * review with a body, an open thread with three comments and reactions, a
 * resolved outdated thread and a timeline event.
 */
export const conversation91 = {
  entries: [
    {
      comment: conversationComment("c-1", {
        author: DANA,
        body: [
          "Here is the token-expiry flow after this change:",
          "",
          "```mermaid",
          "sequenceDiagram",
          "  Android->>Companion: pullRequest/read",
          "  Companion->>Plugin: forge.pullRequest.read",
          "  Plugin-->>Companion: AuthRequired",
          "  Companion-->>Android: -32081",
          "```",
          "",
          `![Expired token banner](${FORGE_IMAGE_URL})`,
        ].join("\n"),
        createdAt: "2026-10-21T08:40:00Z",
        reactions: [{ content: "rocket", count: 2, viewerReacted: false }],
      }),
      kind: "comment",
    },
    {
      author: MIKHAIL,
      body: conversationComment("r-1-body", {
        body: "Two small things inline; the mapping itself looks right.",
        createdAt: "2026-10-21T09:05:00Z",
      }),
      createdAt: "2026-10-21T09:05:00Z",
      id: "r-1",
      kind: "review",
      verdict: "changesRequested",
    },
    {
      kind: "reviewThread",
      thread: {
        comments: [
          conversationComment("c-2", {
            body: "stderr is discarded here, so an expired token surfaces as a timeout.",
            createdAt: "2026-10-21T09:10:00Z",
            reactions: [
              { content: "thumbsUp", count: 3, viewerReacted: true },
              { content: "eyes", count: 1, viewerReacted: false },
            ],
          }),
          conversationComment("c-3", {
            author: DANA,
            body: "Good catch. Should `AuthRequired` carry the host's hint?",
            createdAt: "2026-10-21T09:20:00Z",
            updatedAt: "2026-10-21T09:22:00Z",
          }),
          conversationComment("c-4", {
            author: VIEWER,
            body: "Yes, keep the hint; the Accounts sheet already shows it.",
            createdAt: "2026-10-21T09:31:00Z",
            reactions: [{ content: "heart", count: 1, viewerReacted: false }],
          }),
        ],
        anchor: {
          kind: "line",
          line: 214,
          path: "crates/companion-core/src/vcs/plugin.rs",
          side: "new",
          startLine: null,
        },
        id: "rt-1",
        iteration: null,
        outdated: false,
        resolution: { kind: "conversation", resolved: false },
        reviewId: "r-1",
        viewerCanReply: true,
      },
    },
    {
      kind: "reviewThread",
      thread: {
        comments: [
          conversationComment("c-5", {
            body: "Nit: this timeout constant moved to `forge/limits.rs`.",
            createdAt: "2026-10-21T09:12:00Z",
          }),
        ],
        anchor: { kind: "file", path: "crates/companion-core/src/forge/reads.rs" },
        id: "rt-2",
        iteration: null,
        outdated: true,
        resolution: { kind: "conversation", resolved: true },
        reviewId: null,
        viewerCanReply: true,
      },
    },
    {
      author: DANA,
      category: "push",
      createdAt: "2026-10-21T10:02:00Z",
      id: "e-1",
      kind: "event",
      text: "merged main into this branch",
    },
  ],
  nextCursor: null,
  openIssuesBlockMerge: null,
};

const ARC_ROBOT = { avatarUrl: null, kind: "bot", login: "arc-robot" };
const AI_REVIEWER = { avatarUrl: null, kind: "ai", login: "code-assistant" };
const OLGA = { avatarUrl: null, kind: "user", login: "olga.v" };

/** An Arcanum-shaped issue thread: no avatars, an issue lifecycle and an iteration. */
function issueThread(
  id: string,
  overrides: Record<string, unknown>,
  comments: readonly Record<string, unknown>[],
): Record<string, unknown> {
  return {
    kind: "reviewThread",
    thread: {
      anchor: { kind: "pullRequest" },
      comments,
      id,
      iteration: { id: "it-3", number: 3 },
      outdated: false,
      resolution: { changedAt: null, changedBy: null, kind: "issue", state: "open" },
      reviewId: null,
      viewerCanReply: true,
      ...overrides,
    },
  };
}

function arcEvent(id: string, createdAt: string, text: string): Record<string, unknown> {
  return { author: OLGA, category: "push", createdAt, id, kind: "event", text };
}

/**
 * An Arcanum-shaped conversation: no avatars anywhere, three iterations
 * uploaded in a row, a merge-blocking verdict without text, issues that block
 * merging (open on a line and on the whole PR, resolved by a robot, dropped on
 * an older iteration), an AI reviewer and two nearby comments of one author.
 */
export const conversationArcanum = {
  entries: [
    arcEvent("ev-1", "2026-10-20T08:00:00Z", "uploaded iteration 1"),
    arcEvent("ev-2", "2026-10-20T09:00:00Z", "uploaded iteration 2"),
    arcEvent("ev-3", "2026-10-20T10:00:00Z", "uploaded iteration 3"),
    issueThread(
      "is-dropped",
      {
        anchor: { kind: "file", path: "disk/volga/old.py" },
        iteration: { id: "it-1", number: 1 },
        outdated: true,
        resolution: {
          changedAt: "2026-10-20T10:30:00Z",
          changedBy: OLGA,
          kind: "issue",
          state: "dropped",
        },
      },
      [conversationComment("ic-1", { author: AI_REVIEWER, body: "Unused import.", createdAt: "2026-10-20T10:20:00Z" })],
    ),
    issueThread(
      "is-open-line",
      {
        anchor: { kind: "line", line: 12, path: "disk/volga/api.py", side: "new", startLine: 10 },
        reviewId: "rv-block",
      },
      [
        conversationComment("ic-2", {
          author: AI_REVIEWER,
          body: "## Race\n\nThe lock is released before the write completes.",
          createdAt: "2026-10-20T10:40:00Z",
        }),
      ],
    ),
    {
      author: AI_REVIEWER,
      body: null,
      createdAt: "2026-10-20T10:45:00Z",
      id: "rv-block",
      kind: "review",
      verdict: "mergeBlocked",
    },
    issueThread("is-open-pr", { viewerCanReply: false }, [
      conversationComment("ic-3", {
        author: ARC_ROBOT,
        body: "Release notes are missing.",
        createdAt: "2026-10-20T11:00:00Z",
      }),
    ]),
    {
      comment: conversationComment("ac-1", { author: OLGA, body: "Fixing both now.", createdAt: "2026-10-20T11:10:00Z" }),
      kind: "comment",
    },
    {
      comment: conversationComment("ac-2", { author: OLGA, body: "Pushed.", createdAt: "2026-10-20T11:13:00Z" }),
      kind: "comment",
    },
    issueThread(
      "is-resolved",
      {
        anchor: { kind: "file", path: "disk/volga/config.yaml" },
        iteration: { id: "it-2", number: 2 },
        resolution: {
          changedAt: "2026-10-20T11:20:00Z",
          changedBy: ARC_ROBOT,
          kind: "issue",
          state: "resolved",
        },
      },
      [conversationComment("ic-4", { author: OLGA, body: "Bump the quota.", createdAt: "2026-10-20T11:15:00Z" })],
    ),
    {
      author: AI_REVIEWER,
      body: null,
      createdAt: "2026-10-20T11:30:00Z",
      id: "rv-approve",
      kind: "review",
      verdict: "approvalWithdrawn",
    },
  ],
  nextCursor: null,
  openIssuesBlockMerge: true,
};
