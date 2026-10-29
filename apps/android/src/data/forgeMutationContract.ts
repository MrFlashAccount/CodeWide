/**
 * Validated results of PR file reads and forge write mutations. Every write
 * result is the Companion's acknowledged outcome; the client never assumes a
 * write succeeded without one.
 */
import {
  actionCatalog,
  type ActionCatalog,
  type DroppedActionReporter,
} from "./forgeActionCatalog";
import { headRevision, type HeadRevision } from "./forgeContract";
import {
  pullRequestAttention,
  type SupportedPullRequestAttention,
} from "./forgePullRequestContract";
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
} from "./forgeWire";
import { draftId, hunk, threadId, type DraftId, type Hunk, type ThreadId } from "./reviewContract";

/** Where a viewed mark lives: on the forge, or only on this companion. */
export type ViewedMark = { readonly source: "companion" | "forge"; readonly viewed: boolean };

/** One changed file of a PR in recorded-patch mode. */
export type PullRequestFile = {
  readonly additions: number;
  readonly deletions: number;
  readonly patch:
    | { readonly hunks: readonly Hunk[]; readonly state: "present"; readonly text: string }
    | { readonly bytes: number | null; readonly state: "tooLarge" }
    | { readonly state: "binary" }
    | { readonly state: "notProvided" };
  readonly path: string;
  readonly previousPath: string | null;
  readonly status: "added" | "copied" | "modified" | "removed" | "renamed";
  readonly viewed: ViewedMark;
};

/** One page of PR files; `truncated` reports forge or plugin file limits. */
export type PullRequestFilesPage = {
  readonly files: readonly PullRequestFile[];
  readonly headRevision: HeadRevision;
  readonly nextCursor: string | null;
  readonly truncated: { readonly shown: number; readonly total: number } | null;
};

function viewedMark(value: unknown, path: string): ViewedMark {
  const mark = record(value, path);
  return {
    source: oneOf(mark.source, ["forge", "companion"], `${path}.source`),
    viewed: flag(mark.viewed, `${path}.viewed`),
  };
}

function file(value: unknown, path: string): PullRequestFile {
  const entry = record(value, path);
  const patch = record(entry.patch, `${path}.patch`);
  const patchState = oneOf(
    patch.state,
    ["present", "tooLarge", "binary", "notProvided"],
    `${path}.patch.state`,
  );
  return {
    additions: count(entry.additions, `${path}.additions`),
    deletions: count(entry.deletions, `${path}.deletions`),
    patch:
      patchState === "present"
        ? {
            hunks: list(patch.hunks, `${path}.patch.hunks`, hunk),
            state: patchState,
            text: text(patch.text, `${path}.patch.text`),
          }
        : patchState === "tooLarge"
          ? { bytes: optionalCount(patch.bytes, `${path}.patch.bytes`), state: patchState }
          : { state: patchState },
    path: nonEmptyText(entry.path, `${path}.path`),
    previousPath: optionalText(entry.previousPath, `${path}.previousPath`),
    status: oneOf(
      entry.status,
      ["added", "modified", "removed", "renamed", "copied"],
      `${path}.status`,
    ),
    viewed: viewedMark(entry.viewed, `${path}.viewed`),
  };
}

/** Parses `companion/pullRequest/files/read`. */
export function parseFilesPage(value: unknown): PullRequestFilesPage | null {
  return decodeOrNull(() => {
    const page = record(value, "result");
    const truncated = page.truncated === null ? null : record(page.truncated, "truncated");
    return {
      files: list(page.files, "files", file),
      headRevision: headRevision(page.headRevision, "headRevision"),
      nextCursor: optionalText(page.nextCursor, "nextCursor"),
      truncated:
        truncated === null
          ? null
          : {
              shown: count(truncated.shown, "truncated.shown"),
              total: count(truncated.total, "truncated.total"),
            },
    };
  });
}

/** Parses `companion/pullRequest/viewed/set`. */
export function parseViewedSet(value: unknown): ({ readonly path: string } & ViewedMark) | null {
  return decodeOrNull(() => {
    const result = record(value, "result");
    return { path: nonEmptyText(result.path, "path"), ...viewedMark(result, "result") };
  });
}

/** Parses the acknowledged `companion/pullRequest/attention/seen` marker. */
export function parseAttentionSeen(value: unknown): SupportedPullRequestAttention | null {
  return decodeOrNull(() => pullRequestAttention(value, "result"));
}

/** `companion/pullRequest/action/run` result with the refreshed catalog. */
export type ActionRunResult = {
  readonly catalog: ActionCatalog;
  readonly message: string | null;
  readonly runId: string;
};

/** Parses `companion/pullRequest/action/run`. */
export function parseActionRun(
  value: unknown,
  reportDropped: DroppedActionReporter,
): ActionRunResult | null {
  return decodeOrNull(() => {
    const result = record(value, "result");
    return {
      catalog: actionCatalog(result.catalog, "catalog", reportDropped),
      message: optionalText(result.message, "message"),
      runId: nonEmptyText(result.runId, "runId"),
    };
  });
}

/** Per-draft outcome of Submit review; partial publication is explicit. */
export type SubmitOutcome = {
  readonly drafts: readonly {
    readonly agent: "failed" | "notRequested" | "sent";
    readonly draftId: DraftId;
    readonly error: string | null;
    readonly pr: "failed" | "outdated" | "published";
  }[];
  readonly reviewUrl: string | null;
  readonly runId: string;
};

/** Parses `companion/pullRequest/review/submit`. */
export function parseSubmitOutcome(value: unknown): SubmitOutcome | null {
  return decodeOrNull(() => {
    const result = record(value, "result");
    return {
      drafts: list(result.drafts, "drafts", (entry, path) => {
        const draft = record(entry, path);
        return {
          agent: oneOf(draft.agent, ["sent", "failed", "notRequested"], `${path}.agent`),
          draftId: draftId(draft.draftId, `${path}.draftId`),
          error: optionalText(draft.error, `${path}.error`),
          pr: oneOf(draft.pr, ["published", "failed", "outdated"], `${path}.pr`),
        };
      }),
      reviewUrl: optionalText(result.reviewUrl, "reviewUrl"),
      runId: nonEmptyText(result.runId, "runId"),
    };
  });
}

/**
 * A local checkout the Companion suggests for a new PR review chat. `path` is admitted by
 * construction (a project root or a known thread directory).
 */
export type ReviewChatWorkspaceCandidate = {
  readonly path: string;
  readonly reason: "pullRequestBranch" | "repository";
};

/**
 * No live review chat exists and the client chooses its directory. Candidates are ranked; the
 * first is the default, and an empty list offers none.
 */
type ReviewChatNeedsWorkspace = {
  readonly candidates: readonly ReviewChatWorkspaceCandidate[];
  readonly kind: "needsWorkspace";
};

/** `chat/ensure` with `workspace`: the canonical thread, or the choice it needs first. */
export type ReviewChatOpening =
  | ReviewChatNeedsWorkspace
  | { readonly created: boolean; readonly kind: "ready"; readonly threadId: ThreadId };

/** `scenario/start` with a `workspace` target: the started thread, or the choice it needs first. */
export type ScenarioStartOutcome =
  | ReviewChatNeedsWorkspace
  | { readonly created: boolean; readonly kind: "started"; readonly threadId: ThreadId };

function needsWorkspace(result: Readonly<Record<string, unknown>>): ReviewChatNeedsWorkspace {
  return {
    candidates: list(result.candidates, "candidates", (entry, path) => {
      const candidate = record(entry, path);
      return {
        path: nonEmptyText(candidate.path, `${path}.path`),
        reason: oneOf(candidate.reason, ["pullRequestBranch", "repository"], `${path}.reason`),
      };
    }),
    kind: "needsWorkspace",
  };
}

/** Parses `companion/pullRequest/scenario/start` sent with a `workspace` target. */
export function parseScenarioStart(value: unknown): ScenarioStartOutcome | null {
  return decodeOrNull(() => {
    const result = record(value, "result");
    if (oneOf(result.kind, ["started", "needsWorkspace"], "kind") === "needsWorkspace") {
      return needsWorkspace(result);
    }
    return {
      created: flag(result.created, "created"),
      kind: "started",
      threadId: threadId(result.threadId, "threadId"),
    };
  });
}

/** Parses the canonical, message-free PR conversation returned by `chat/ensure` with `workspace`. */
export function parseReviewChatEnsure(value: unknown): ReviewChatOpening | null {
  return decodeOrNull(() => {
    const result = record(value, "result");
    if (oneOf(result.kind, ["ready", "needsWorkspace"], "kind") === "needsWorkspace") {
      return needsWorkspace(result);
    }
    return {
      created: flag(result.created, "created"),
      kind: "ready",
      threadId: threadId(result.threadId, "threadId"),
    };
  });
}
