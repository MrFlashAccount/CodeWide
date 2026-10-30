/**
 * Pure projections of a PR files page for the Changes tab: recorded-patch and
 * whole-file editor documents, viewed counts and labels, draft comments and
 * hunk lookup.
 */
import type { PullRequestFile } from "../../../data/forgeMutationContract";
import type { Hunk, HunkId } from "../../../data/reviewContract";
import type { DraftComment } from "../../../data/reviewDraftContract";
import type { CodeReviewComment } from "../../review/comments/reviewComment";
import {
  codeReviewDocumentRevision,
  type CodeReviewDocument,
  type CodeReviewPatch,
} from "../../review/editor/editorBridge";

const PATCH_KINDS: Readonly<Record<PullRequestFile["status"], CodeReviewPatch["kind"]>> = {
  added: "add",
  copied: "update",
  modified: "update",
  removed: "delete",
  renamed: "update",
};

/** Recorded-patch document (`source: ""`) of one file; files without a patch get no document. */
export function fileDocument(file: PullRequestFile): CodeReviewDocument | null {
  if (file.patch.state !== "present") {
    return null;
  }
  const patches = [{ diff: file.patch.text, kind: PATCH_KINDS[file.status] }];
  return {
    patches,
    path: file.path,
    revision: codeReviewDocumentRevision(file.path, "", patches),
    source: "",
  };
}

/**
 * Whether the whole head file is worth reading for this file: it has a patch
 * to show inline, and the head side is neither empty (removed) nor entirely
 * the patch already (added).
 */
export function showsWholeFile(file: PullRequestFile): boolean {
  return file.patch.state === "present" && file.status !== "added" && file.status !== "removed";
}

/**
 * The whole head file with the recorded patch inline (`fullFileDiff`), or
 * `null` when the patch's new side does not line up with `content` (for
 * example a symlink, whose patch is its target path). The editor then keeps
 * the recorded-patch document instead of reporting that the diff cannot be
 * aligned. CRLF is shown as LF, as the patch lines are compared without it.
 */
export function wholeFileDocument(
  file: PullRequestFile,
  content: string,
): CodeReviewDocument | null {
  if (file.patch.state !== "present") {
    return null;
  }
  const source = content.replaceAll("\r\n", "\n");
  if (!patchMatchesSource(file.patch.text, source)) {
    return null;
  }
  const patches = [{ diff: file.patch.text, kind: PATCH_KINDS[file.status] }];
  return {
    fullFileDiff: true,
    patches,
    path: file.path,
    revision: codeReviewDocumentRevision(file.path, source, patches),
    source,
  };
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(?<start>\d+)(?:,(?<count>\d+))? @@/u;
const TRAILING_CARRIAGE_RETURN = /\r$/u;
/** Old-side lines and the "no newline at end of file" note: not part of the head file. */
const OLD_SIDE_MARKERS: ReadonlySet<string> = new Set(["-", "\\"]);
/** Context and added lines; an empty line is context whose leading space was trimmed. */
const NEW_SIDE_MARKERS: ReadonlySet<string> = new Set(["+", " ", ""]);

/** Every hunk's new side (context and additions) appears in `source` at its stated line. */
function patchMatchesSource(patch: string, source: string): boolean {
  const lines = source.split("\n");
  let next = 0;
  let remaining = 0;
  let hunks = 0;
  for (const raw of patch.split("\n")) {
    const header = hunkHeader(raw);
    if (header !== null) {
      hunks += 1;
      next = header.start;
      remaining = header.count;
      continue;
    }
    const marker = raw.slice(0, 1);
    if (remaining === 0 || OLD_SIDE_MARKERS.has(marker)) {
      continue;
    }
    if (
      !NEW_SIDE_MARKERS.has(marker) ||
      lines[next] !== raw.slice(1).replace(TRAILING_CARRIAGE_RETURN, "")
    ) {
      return false;
    }
    next += 1;
    remaining -= 1;
  }
  return hunks > 0;
}

/** A hunk header's zero-based new-side start and new-side line count. */
function hunkHeader(raw: string): { readonly count: number; readonly start: number } | null {
  const groups = HUNK_HEADER.exec(raw)?.groups;
  if (groups === undefined) {
    return null;
  }
  return {
    count: groups.count === undefined ? 1 : Number(groups.count),
    start: Math.max(0, Number(groups.start) - 1),
  };
}

/** `3 of 14 viewed`. */
export function viewedSummary(files: readonly PullRequestFile[]): string {
  return `${String(files.filter((file) => file.viewed.viewed).length)} of ${String(files.length)} viewed`;
}

/** Where a viewed mark lives: `Viewed · github.com` or `Viewed · this companion` (Q6). */
export function viewedLabel(file: PullRequestFile, host: string): string {
  return file.viewed.source === "forge" ? `Viewed · ${host}` : "Viewed · this companion";
}

/** The hunk containing a line on one side, for a draft anchor. */
export function hunkAt(file: PullRequestFile, line: number, side: "new" | "old"): Hunk | null {
  if (file.patch.state !== "present") {
    return null;
  }
  return (
    file.patch.hunks.find((hunk) => {
      const start = side === "new" ? hunk.newStart : hunk.oldStart;
      const length = side === "new" ? hunk.newLines : hunk.oldLines;
      return line >= start && line < start + Math.max(1, length);
    }) ?? null
  );
}

/** First new-side line of each hunk id in the loaded files. */
export function hunkLocations(
  files: readonly PullRequestFile[],
): ReadonlyMap<HunkId, { readonly line: number; readonly path: string }> {
  const locations = new Map<HunkId, { readonly line: number; readonly path: string }>();
  for (const file of files) {
    for (const hunk of file.patch.state === "present" ? file.patch.hunks : []) {
      locations.set(hunk.id, {
        line: Math.max(1, hunk.newStart),
        path: file.path,
      });
    }
  }
  return locations;
}

/** Drafts of one file as inline editor comments. */
export function draftEditorComments(
  drafts: readonly DraftComment[],
  path: string,
): readonly CodeReviewComment[] {
  return drafts
    .filter((draft) => draft.anchor.path === path)
    .map((draft) => {
      const createdAt = Date.parse(draft.createdAt);
      return {
        body: draft.body,
        createdAt: Number.isNaN(createdAt) ? 0 : createdAt,
        id: draft.id,
        line: draft.anchor.startLine,
        path: draft.anchor.path,
        side: draft.anchor.side,
      };
    });
}
