/**
 * Agent-written review guides. The Companion validates the guide JSON written
 * by the author thread; the device re-validates the wire shape, and the guide
 * prose stays untrusted agent output labelled with its author thread.
 */
import {
  diffSource,
  guideId,
  hunkId,
  stopId,
  threadId,
  type DiffSource,
  type GuideId,
  type HunkId,
  type StopId,
  type ThreadId,
} from "./reviewContract";
import { GUIDE_TOO_LARGE_CODE, INVALID_GUIDE_CODE } from "./forgeErrors";
import {
  decodeOrNull,
  ForgeWireError,
  list,
  nonEmptyText,
  oneOf,
  optionalText,
  record,
  text,
} from "./forgeWire";

/** One stop of the walk: a titled group of hunks with optional narration. */
export type GuideStop = {
  readonly hunkIds: readonly HunkId[];
  readonly prose: string | null;
  readonly stopId: StopId;
  readonly summary: string;
  readonly title: string;
};

/** A chapter groups stops in reading order. */
export type GuideChapter = {
  readonly chapterId: string;
  readonly stops: readonly GuideStop[];
  readonly summary: string | null;
  readonly title: string;
};

/** The latest valid guide of one diff source. */
export type ReviewGuide = {
  readonly authorThreadId: ThreadId;
  readonly chapters: readonly GuideChapter[];
  readonly createdAt: string;
  readonly guideId: GuideId;
  readonly revision: string;
  readonly source: DiffSource;
  readonly summary: string;
  readonly support: readonly HunkId[];
  readonly title: string;
};

/** Stop progress; `changed` is set only by the Companion's re-match after a push. */
export type StopProgressState = "accepted" | "changed" | "commented" | "pending";

/** `companion/review/guide/read`: guide, progress, an in-flight request and the last rejection. */
export type GuideState = {
  readonly currentRevision: string;
  readonly guide: ReviewGuide | null;
  readonly lastError: {
    readonly at: string;
    readonly code: typeof GUIDE_TOO_LARGE_CODE | typeof INVALID_GUIDE_CODE;
    readonly reason: string;
  } | null;
  readonly pending: { readonly authorThreadId: ThreadId; readonly requestId: string } | null;
  /** Progress by stop id; a stop absent here is `pending`. */
  readonly progress: Readonly<Record<string, StopProgressState>>;
};

function guideStop(value: unknown, path: string): GuideStop {
  const stop = record(value, path);
  return {
    hunkIds: list(stop.hunkIds, `${path}.hunkIds`, hunkId),
    prose: optionalText(stop.prose, `${path}.prose`),
    stopId: stopId(stop.stopId, `${path}.stopId`),
    summary: text(stop.summary, `${path}.summary`),
    title: text(stop.title, `${path}.title`),
  };
}

function guideChapter(value: unknown, path: string): GuideChapter {
  const chapter = record(value, path);
  return {
    chapterId: nonEmptyText(chapter.chapterId, `${path}.chapterId`),
    stops: list(chapter.stops, `${path}.stops`, guideStop),
    summary: optionalText(chapter.summary, `${path}.summary`),
    title: text(chapter.title, `${path}.title`),
  };
}

function reviewGuide(value: unknown, path: string): ReviewGuide {
  const guide = record(value, path);
  return {
    authorThreadId: threadId(guide.authorThreadId, `${path}.authorThreadId`),
    chapters: list(guide.chapters, `${path}.chapters`, guideChapter),
    createdAt: text(guide.createdAt, `${path}.createdAt`),
    guideId: guideId(guide.guideId, `${path}.guideId`),
    revision: text(guide.revision, `${path}.revision`),
    source: diffSource(guide.source, `${path}.source`),
    summary: text(guide.summary, `${path}.summary`),
    support: list(guide.support, `${path}.support`, hunkId),
    title: text(guide.title, `${path}.title`),
  };
}

/** Parses `companion/review/guide/read`. */
export function parseGuideState(value: unknown): GuideState | null {
  return decodeOrNull(() => {
    const state = record(value, "result");
    const pending = state.pending === null ? null : record(state.pending, "pending");
    const lastError = state.lastError === null ? null : record(state.lastError, "lastError");
    const progress: Record<string, StopProgressState> = {};
    for (const item of list(state.progress, "progress", (entry, path) => record(entry, path))) {
      progress[stopId(item.stopId, "progress.stopId")] = oneOf(
        item.state,
        ["pending", "commented", "accepted", "changed"],
        "progress.state",
      );
    }
    return {
      currentRevision: text(state.currentRevision, "currentRevision"),
      guide: state.guide === null ? null : reviewGuide(state.guide, "guide"),
      lastError:
        lastError === null
          ? null
          : {
              at: text(lastError.at, "lastError.at"),
              code: guideErrorCode(lastError.code),
              reason: text(lastError.reason, "lastError.reason"),
            },
      pending:
        pending === null
          ? null
          : {
              authorThreadId: threadId(pending.authorThreadId, "pending.authorThreadId"),
              requestId: nonEmptyText(pending.requestId, "pending.requestId"),
            },
      progress,
    };
  });
}

function guideErrorCode(value: unknown): typeof GUIDE_TOO_LARGE_CODE | typeof INVALID_GUIDE_CODE {
  if (value === INVALID_GUIDE_CODE || value === GUIDE_TOO_LARGE_CODE) {
    return value;
  }
  throw new ForgeWireError("lastError.code");
}

/** Parses `companion/review/guide/request`. */
export function parseGuideRequest(
  value: unknown,
): { readonly authorThreadId: ThreadId; readonly requestId: string } | null {
  return decodeOrNull(() => {
    const result = record(value, "result");
    return {
      authorThreadId: threadId(result.authorThreadId, "authorThreadId"),
      requestId: nonEmptyText(result.requestId, "requestId"),
    };
  });
}
