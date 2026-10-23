/**
 * Wire fixtures written from the approved companion forge/review contract
 * (architecture Canvas, "Companion wire contract"), not from backend output.
 * They model what a conforming companion sends; tests and rendered previews share them.
 */

const GITHUB_ICON = { glyph: null, iconKey: "github" };

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

/** An external provider whose plugin glyph is sanitized and whose checks need a second credential. */
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
    "forge.read@1",
    "forge.diff@1",
    "forge.actions@1",
    "forge.review@1",
  ],
  checksCredential: { state: "missing" },
  defaultHost: "a.yandex-team.ru",
  enabled: true,
  forgeName: "Arcanum",
  icon: { glyph: { path: ARCANUM_GLYPH, viewBox: "0 0 24 24" }, iconKey: "arcanum" },
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
    state: "open",
    title: `Pull request ${number}`,
    updatedAt: "2026-10-21T09:00:00Z",
    webUrl: `https://github.com/MrFlashAccount/CodeWide/pull/${number}`,
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
      supportedCategories: ["reviewRequested", "authored", "assigned", "mentioned", "drafts"],
    },
    { account: expiredAccount, rows: [], supportedCategories: ["reviewRequested", "authored"] },
  ],
};

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
