/**
 * Validated client view of the Companion review contract (`companion/review/*`):
 * diff sources, hunks, companion-owned drafts with independent delivery axes,
 * and agent-written guides. Draft and guide text is user/agent content and is
 * never logged.
 */
import { pullRequestKey, type PullRequestKey } from "./forgeContract";
import { count, decodeOrNull, list, nonEmptyText, oneOf, record, text } from "./forgeWire";

declare const threadIdBrand: unique symbol;
declare const hunkIdBrand: unique symbol;
declare const hunkFingerprintBrand: unique symbol;
declare const draftIdBrand: unique symbol;
declare const guideIdBrand: unique symbol;
declare const stopIdBrand: unique symbol;

/** Thread identity validated at the forge/review boundary. */
export type ThreadId = string & { readonly [threadIdBrand]: true };
/** `<path>#h<ordinal>`, scoped to one diff-source revision. */
export type HunkId = string & { readonly [hunkIdBrand]: true };
/** Content hash of a hunk's changed lines, stable across pushes. */
export type HunkFingerprint = string & { readonly [hunkFingerprintBrand]: true };
/** Client- or companion-generated draft identity. */
export type DraftId = string & { readonly [draftIdBrand]: true };
/** Companion-generated guide identity. */
export type GuideId = string & { readonly [guideIdBrand]: true };
/** Guide stop identity. */
export type StopId = string & { readonly [stopIdBrand]: true };

/** Brands a validated thread id. */
export function threadId(value: unknown, path: string): ThreadId {
  // WHY: the brand's only invariant is the non-empty string checked here; no runtime shape changes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return nonEmptyText(value, path) as ThreadId;
}

/** Brands a locally generated draft id. */
export function newDraftId(value: string): DraftId {
  return draftId(value, "draftId");
}

/** A review target. A pull request never joins the thread change scopes. */
export type DiffSource =
  | {
      readonly kind: "session";
      readonly resource: "lastTurn" | "session" | { readonly turnId: string };
      readonly threadId: ThreadId;
    }
  | {
      readonly kind: "vcs";
      readonly scope: "branch" | "staged" | "uncommitted" | "unstaged";
      readonly workspace: string;
    }
  | { readonly kind: "pullRequest"; readonly pullRequest: PullRequestKey };

/** Canonical string identity of a diff source, used as a resource key. */
export function diffSourceKey(source: DiffSource): string {
  if (source.kind === "pullRequest") {
    return `pr\u0000${source.pullRequest}`;
  }
  if (source.kind === "vcs") {
    return `vcs\u0000${source.workspace}\u0000${source.scope}`;
  }
  const resource =
    typeof source.resource === "string" ? source.resource : `turn:${source.resource.turnId}`;
  return `session\u0000${source.threadId}\u0000${resource}`;
}

/** One hunk of a diff with its stable content fingerprint. */
export type Hunk = {
  readonly fingerprint: HunkFingerprint;
  readonly id: HunkId;
  readonly newLines: number;
  readonly newStart: number;
  readonly oldLines: number;
  readonly oldStart: number;
  readonly ordinal: number;
};

/** Decodes one hunk. */
export function hunk(value: unknown, path: string): Hunk {
  const entry = record(value, path);
  return {
    fingerprint: hunkFingerprint(entry.fingerprint, `${path}.fingerprint`),
    id: hunkId(entry.id, `${path}.id`),
    newLines: count(entry.newLines, `${path}.newLines`),
    newStart: count(entry.newStart, `${path}.newStart`),
    oldLines: count(entry.oldLines, `${path}.oldLines`),
    oldStart: count(entry.oldStart, `${path}.oldStart`),
    ordinal: count(entry.ordinal, `${path}.ordinal`),
  };
}

/** Decodes a wire diff source. */
export function diffSource(value: unknown, path: string): DiffSource {
  const source = record(value, path);
  const kind = oneOf(source.kind, ["session", "vcs", "pullRequest"], `${path}.kind`);
  if (kind === "pullRequest") {
    return { kind, pullRequest: pullRequestKey(source.pullRequest, `${path}.pullRequest`) };
  }
  if (kind === "vcs") {
    return {
      kind,
      scope: oneOf(source.scope, ["staged", "unstaged", "uncommitted", "branch"], `${path}.scope`),
      workspace: nonEmptyText(source.workspace, `${path}.workspace`),
    };
  }
  const resource =
    typeof source.resource === "string"
      ? oneOf(source.resource, ["session", "lastTurn"], `${path}.resource`)
      : {
          turnId: nonEmptyText(
            record(source.resource, `${path}.resource`).turnId,
            `${path}.turnId`,
          ),
        };
  return { kind, resource, threadId: threadId(source.threadId, `${path}.threadId`) };
}

/** Decodes one guide identifier. */
export function guideId(value: unknown, path: string): GuideId {
  // WHY: the brand's only invariant is the non-empty string checked here; no runtime shape changes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return nonEmptyText(value, path) as GuideId;
}

/** Decodes one stop identifier. */
export function stopId(value: unknown, path: string): StopId {
  // WHY: the brand's only invariant is the non-empty string checked here; no runtime shape changes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return nonEmptyText(value, path) as StopId;
}

/** Decodes one hunk identifier. */
export function hunkId(value: unknown, path: string): HunkId {
  // WHY: the brand's only invariant is the non-empty string checked here; no runtime shape changes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return nonEmptyText(value, path) as HunkId;
}

/** Decodes one hunk fingerprint. */
export function hunkFingerprint(value: unknown, path: string): HunkFingerprint {
  // WHY: the brand's only invariant is the non-empty hash string checked here; no runtime shape changes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return nonEmptyText(value, path) as HunkFingerprint;
}

/** Decodes one draft identifier. */
export function draftId(value: unknown, path: string): DraftId {
  // WHY: the brand's only invariant is the non-empty string checked here; no runtime shape changes.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return nonEmptyText(value, path) as DraftId;
}

/** `{ revision, files }` of `companion/review/hunks/read`. */
export type HunkCatalog = {
  readonly files: readonly { readonly hunks: readonly Hunk[]; readonly path: string }[];
  readonly revision: string;
};

/** Parses `companion/review/hunks/read`. */
export function parseHunkCatalog(value: unknown): HunkCatalog | null {
  return decodeOrNull(() => {
    const result = record(value, "result");
    return {
      files: list(result.files, "files", (file, filePath) => {
        const entry = record(file, filePath);
        return {
          hunks: list(entry.hunks, `${filePath}.hunks`, hunk),
          path: nonEmptyText(entry.path, `${filePath}.path`),
        };
      }),
      revision: text(result.revision, "revision"),
    };
  });
}
