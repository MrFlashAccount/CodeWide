/**
 * Validated client view of PR reads: list pages, the atomic overview and the
 * activity page. Titles, descriptions and comments are untrusted forge
 * content; rich content uses the safe renderer and is never logged.
 */
import {
  actionCatalog,
  type ActionCatalog,
  type DroppedActionReporter,
} from "./forgeActionCatalog";
import {
  attentionRevision,
  accountState,
  forgeAccountKey,
  headRevision,
  pullRequestKey,
  type AccountState,
  type AttentionRevision,
  type ForgeAccountKey,
  type HeadRevision,
  type PullRequestKey,
} from "./forgeContract";
import { providerIcon, type ProviderIcon } from "./forgeProviderIcon";
import {
  count,
  decodeOrNull,
  flag,
  list,
  nonEmptyText,
  oneOf,
  optionalCount,
  optionalText,
  record,
  text,
  textList,
} from "./forgeWire";
import { threadId, type ThreadId } from "./reviewContract";
import { unknownRecord } from "./unknownRecord";

const PULL_REQUEST_CATEGORIES = [
  "involved",
  "reviewRequested",
  "authored",
  "assigned",
  "mentioned",
  "drafts",
  "all",
] as const;
/** List category; each section declares which ones its account supports. */
export type PullRequestCategory = (typeof PULL_REQUEST_CATEGORIES)[number];
/** Forge PR state. */
type PullRequestState = "closed" | "draft" | "merged" | "open";

/** Aggregate checks; `unavailable` carries its reason (for example a missing CI credential). */
export type CheckSummary =
  | {
      readonly failing: number;
      readonly passed: number;
      readonly pending: number;
      readonly state: "failing" | "none" | "passing" | "pending";
    }
  | { readonly reason: string; readonly state: "unavailable" };

/** One check run. */
export type CheckItem = {
  readonly checkId: string;
  readonly detailsUrl: string | null;
  readonly durationSeconds: number | null;
  readonly name: string;
  readonly state: "cancelled" | "failed" | "passed" | "pending" | "skipped";
};

/** One activity item: a comment, review or timeline event. */
export type ActivityItem = {
  readonly author: string;
  readonly body: string;
  readonly createdAt: string;
  readonly id: string;
  readonly kind: "comment" | "event" | "review";
  readonly line: number | null;
  readonly path: string | null;
  readonly reviewThreadId: string | null;
  readonly verdictLabel: string | null;
};

/** One page of activity. */
export type ActivityPage = {
  readonly items: readonly ActivityItem[];
  readonly nextCursor: string | null;
};

/** A thread linked to a PR, with the reason it was linked. */
export type LinkedThread = {
  readonly source: "agent" | "branch" | "manual";
  readonly threadId: ThreadId;
};

/** One row of the PR list. */
export type PullRequestRow = {
  readonly account: ForgeAccountKey;
  readonly attention: PullRequestAttention;
  readonly author: string;
  readonly checks: CheckSummary;
  readonly linkedThreadCount: number;
  readonly localCheckout: boolean;
  readonly number: string;
  readonly pullRequest: PullRequestKey;
  readonly repository: string;
  readonly reviewRequestedFromMe: boolean;
  /** The canonical review chat; `null` before one exists or from an older Companion. */
  readonly reviewThreadId: ThreadId | null;
  readonly state: PullRequestState;
  readonly title: string;
  readonly updatedAt: string;
  readonly webUrl: string;
};

/** Whether the current provider activity revision has been displayed. */
export type SupportedPullRequestAttention = {
  readonly revision: AttentionRevision;
  readonly state: "new" | "seen";
};

/** A revision marker, or an explicit legacy-Companion capability gap. */
type PullRequestAttention =
  | {
      readonly state: "unsupported";
    }
  | SupportedPullRequestAttention;

/** One account's section: its state degrades only this section. */
export type PullRequestListSection = {
  readonly account: AccountState;
  readonly rows: readonly PullRequestRow[];
  readonly supportedCategories: readonly PullRequestCategory[];
};

/** Companion list/search page; the cursor spans every selected account. */
export type PullRequestListPage = {
  readonly category: PullRequestCategory;
  readonly fetchedAt: string;
  readonly nextCursor: string | null;
  readonly repositories: readonly string[];
  readonly sections: readonly PullRequestListSection[];
};

/** Atomic overview snapshot of `companion/pullRequest/read`. */
export type PullRequestOverview = {
  readonly account: AccountState;
  readonly activity: ActivityPage;
  readonly attention: PullRequestAttention;
  readonly author: string;
  readonly baseBranch: string;
  readonly catalog: ActionCatalog;
  readonly checkItems: readonly CheckItem[];
  readonly checks: CheckSummary;
  readonly description: string;
  readonly fetchedAt: string;
  readonly headBranch: string;
  readonly headRevision: HeadRevision;
  readonly links: readonly LinkedThread[];
  readonly localCheckout: { readonly branch: string; readonly workspace: string } | null;
  readonly merge: {
    readonly reason: string | null;
    readonly state: "blocked" | "conflicts" | "ready" | "unknown";
  };
  readonly number: string;
  readonly pullRequest: PullRequestKey;
  readonly repository: string;
  /** The one ordinary conversation owned by this PR workspace. */
  readonly reviewThread: LinkedThread | null;
  readonly state: PullRequestState;
  readonly stats: {
    readonly additions: number;
    readonly deletions: number;
    readonly files: number;
  };
  readonly title: string;
  readonly webUrl: string;
};

const STATES = ["open", "draft", "merged", "closed"] as const;

/** Decodes a checks summary. */
function checkSummary(value: unknown, path: string): CheckSummary {
  const summary = record(value, path);
  if (summary.state === "unavailable") {
    return { reason: text(summary.reason, `${path}.reason`), state: "unavailable" };
  }
  return {
    failing: count(summary.failing, `${path}.failing`),
    passed: count(summary.passed, `${path}.passed`),
    pending: count(summary.pending, `${path}.pending`),
    state: oneOf(summary.state, ["passing", "failing", "pending", "none"], `${path}.state`),
  };
}

function checkItem(value: unknown, path: string): CheckItem {
  const item = record(value, path);
  return {
    checkId: nonEmptyText(item.checkId, `${path}.checkId`),
    detailsUrl: optionalText(item.detailsUrl, `${path}.detailsUrl`),
    durationSeconds: optionalCount(item.durationSeconds, `${path}.durationSeconds`),
    name: text(item.name, `${path}.name`),
    state: oneOf(
      item.state,
      ["passed", "failed", "pending", "skipped", "cancelled"],
      `${path}.state`,
    ),
  };
}

/** Decodes one activity page. */
function activityPage(value: unknown, path: string): ActivityPage {
  const page = record(value, path);
  return {
    items: list(page.items, `${path}.items`, (entry, itemPath) => {
      const item = record(entry, itemPath);
      return {
        author: text(item.author, `${itemPath}.author`),
        body: text(item.body, `${itemPath}.body`),
        createdAt: text(item.createdAt, `${itemPath}.createdAt`),
        id: nonEmptyText(item.id, `${itemPath}.id`),
        kind: oneOf(item.kind, ["comment", "review", "event"], `${itemPath}.kind`),
        line: optionalCount(item.line, `${itemPath}.line`),
        path: optionalText(item.path, `${itemPath}.path`),
        reviewThreadId: optionalText(item.reviewThreadId, `${itemPath}.reviewThreadId`),
        verdictLabel: optionalText(item.verdictLabel, `${itemPath}.verdictLabel`),
      };
    }),
    nextCursor: optionalText(page.nextCursor, `${path}.nextCursor`),
  };
}

function linkedThread(value: unknown, path: string): LinkedThread {
  const link = record(value, path);
  return {
    source: oneOf(link.source, ["branch", "manual", "agent"], `${path}.source`),
    threadId: threadId(link.threadId, `${path}.threadId`),
  };
}

function row(value: unknown, path: string): PullRequestRow {
  const entry = record(value, path);
  return {
    account: forgeAccountKey(entry.account, `${path}.account`),
    attention: pullRequestReadAttention(entry.attention, `${path}.attention`),
    author: text(entry.author, `${path}.author`),
    checks: checkSummary(entry.checks, `${path}.checks`),
    linkedThreadCount: count(entry.linkedThreadCount, `${path}.linkedThreadCount`),
    localCheckout: flag(entry.localCheckout, `${path}.localCheckout`),
    number: nonEmptyText(entry.number, `${path}.number`),
    pullRequest: pullRequestKey(entry.pullRequest, `${path}.pullRequest`),
    repository: nonEmptyText(entry.repository, `${path}.repository`),
    reviewRequestedFromMe: flag(entry.reviewRequestedFromMe, `${path}.reviewRequestedFromMe`),
    reviewThreadId:
      entry.reviewThreadId === null || entry.reviewThreadId === undefined
        ? null
        : threadId(entry.reviewThreadId, `${path}.reviewThreadId`),
    state: oneOf(entry.state, STATES, `${path}.state`),
    title: text(entry.title, `${path}.title`),
    updatedAt: text(entry.updatedAt, `${path}.updatedAt`),
    webUrl: text(entry.webUrl, `${path}.webUrl`),
  };
}

/** Decodes the Companion-owned PR attention marker. */
export function pullRequestAttention(value: unknown, path: string): SupportedPullRequestAttention {
  const entry = record(value, path);
  return {
    revision: attentionRevision(entry.revision, `${path}.revision`),
    state: oneOf(entry.state, ["new", "seen"], `${path}.state`),
  };
}

/** Keeps reads compatible with Companions from before attention revisions. */
function pullRequestReadAttention(value: unknown, path: string): PullRequestAttention {
  return value === undefined ? { state: "unsupported" } : pullRequestAttention(value, path);
}

function category(value: unknown, path: string): PullRequestCategory {
  return oneOf(value, PULL_REQUEST_CATEGORIES, path);
}

/** Parses the shared `companion/pullRequests/list` and `/search` page shape. */
export function parsePullRequestListPage(value: unknown): PullRequestListPage | null {
  return decodeOrNull(() => {
    const page = record(value, "result");
    return {
      category: category(page.category, "category"),
      fetchedAt: text(page.fetchedAt, "fetchedAt"),
      nextCursor: optionalText(page.nextCursor, "nextCursor"),
      repositories: textList(page.repositories, "repositories"),
      sections: list(page.sections, "sections", (entry, path) => {
        const section = record(entry, path);
        return {
          account: accountState(section.account, `${path}.account`),
          rows: list(section.rows, `${path}.rows`, row),
          supportedCategories: list(
            section.supportedCategories,
            `${path}.supportedCategories`,
            category,
          ),
        };
      }),
    };
  });
}

/** Parses `companion/pullRequest/read`. */
export function parsePullRequestOverview(
  value: unknown,
  reportDropped: DroppedActionReporter,
): PullRequestOverview | null {
  return decodeOrNull(() => {
    const overview = record(value, "result");
    const merge = record(overview.merge, "merge");
    const stats = record(overview.stats, "stats");
    const local =
      overview.localCheckout === null ? null : record(overview.localCheckout, "localCheckout");
    return {
      account: accountState(overview.account, "account"),
      activity: activityPage(overview.activity, "activity"),
      attention: pullRequestReadAttention(overview.attention, "attention"),
      author: text(overview.author, "author"),
      baseBranch: text(overview.baseBranch, "baseBranch"),
      catalog: actionCatalog(overview.catalog, "catalog", reportDropped),
      checkItems: list(overview.checkItems, "checkItems", checkItem),
      checks: checkSummary(overview.checks, "checks"),
      description: text(overview.description, "description"),
      fetchedAt: text(overview.fetchedAt, "fetchedAt"),
      headBranch: text(overview.headBranch, "headBranch"),
      headRevision: headRevision(overview.headRevision, "headRevision"),
      links: list(overview.links, "links", linkedThread),
      localCheckout:
        local === null
          ? null
          : {
              branch: text(local.branch, "localCheckout.branch"),
              workspace: nonEmptyText(local.workspace, "localCheckout.workspace"),
            },
      merge: {
        reason: optionalText(merge.reason, "merge.reason"),
        state: oneOf(merge.state, ["ready", "blocked", "conflicts", "unknown"], "merge.state"),
      },
      number: nonEmptyText(overview.number, "number"),
      pullRequest: pullRequestKey(overview.pullRequest, "pullRequest"),
      repository: nonEmptyText(overview.repository, "repository"),
      reviewThread:
        overview.reviewThread === null || overview.reviewThread === undefined
          ? null
          : linkedThread(overview.reviewThread, "reviewThread"),
      state: oneOf(overview.state, STATES, "state"),
      stats: {
        additions: count(stats.additions, "stats.additions"),
        deletions: count(stats.deletions, "stats.deletions"),
        files: count(stats.files, "stats.files"),
      },
      title: text(overview.title, "title"),
      webUrl: text(overview.webUrl, "webUrl"),
    };
  });
}

/** Parses `companion/pullRequest/activity/read`. */
export function parseActivityPage(value: unknown): ActivityPage | null {
  return decodeOrNull(() => activityPage(value, "result"));
}

/** Parses `companion/pullRequest/links/set`. */
export function parseLinks(value: unknown): readonly LinkedThread[] | null {
  return decodeOrNull(() => list(record(value, "result").links, "links", linkedThread));
}

/** One PR badge of a thread row. */
export type PullRequestBadge = {
  /** The badge provider's icon, shared by every badge of that provider; `null` is the neutral icon. */
  readonly icon: ProviderIcon | null;
  readonly number: string;
  readonly pullRequest: PullRequestKey;
  readonly state: PullRequestState;
};

/** Parses `companion/pullRequestLinks/read` into badges per thread. */
export function parsePullRequestLinks(
  value: unknown,
): Readonly<Record<string, readonly PullRequestBadge[]>> | null {
  return decodeOrNull(() => {
    const links = record(value, "result");
    const icons = providerIcons(links.providerIcons);
    const result: Record<string, readonly PullRequestBadge[]> = {};
    for (const entry of list(links.threads, "threads", record)) {
      result[threadId(entry.threadId, "threads.threadId")] = list(
        entry.pullRequests,
        "threads.pullRequests",
        (item, path) => {
          const badge = record(item, path);
          return {
            icon: typeof badge.pluginId === "string" ? (icons.get(badge.pluginId) ?? null) : null,
            number: nonEmptyText(badge.number, `${path}.number`),
            pullRequest: pullRequestKey(badge.pullRequest, `${path}.pullRequest`),
            state: oneOf(badge.state, STATES, `${path}.state`),
          };
        },
      );
    }
    return result;
  });
}

/**
 * Decodes the per-provider icons of a links read once, so every badge of a
 * provider shares one icon. An older Companion sends none; a bad entry is `null`.
 */
function providerIcons(value: unknown): ReadonlyMap<string, ProviderIcon | null> {
  const icons = new Map<string, ProviderIcon | null>();
  const entries = unknownRecord(value);
  if (entries !== null) {
    for (const [pluginId, icon] of Object.entries(entries)) {
      icons.set(pluginId, providerIcon(icon));
    }
  }
  return icons;
}
