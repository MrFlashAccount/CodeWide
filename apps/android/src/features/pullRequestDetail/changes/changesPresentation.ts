/**
 * Pure projections of a PR files page for the Changes tab: recorded-patch
 * editor documents, viewed counts, per-file draft counts and hunk lookup.
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

const PATCH_STATE_NOTES: Readonly<
  Record<Exclude<PullRequestFile["patch"]["state"], "present">, string>
> = {
  binary: "Binary file",
  notProvided: "No patch",
  tooLarge: "Too large to render",
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

/** `3 of 14 viewed`. */
export function viewedSummary(files: readonly PullRequestFile[]): string {
  return `${String(files.filter((file) => file.viewed.viewed).length)} of ${String(files.length)} viewed`;
}

/** Where a viewed mark lives: `Viewed · github.com` or `Viewed · this companion` (Q6). */
export function viewedLabel(file: PullRequestFile, host: string): string {
  return file.viewed.source === "forge" ? `Viewed · ${host}` : "Viewed · this companion";
}

function changeNote(file: PullRequestFile): string | null {
  if (file.status === "added") {
    return "new file";
  }
  return file.status === "renamed" && file.previousPath !== null
    ? `renamed from ${file.previousPath}`
    : null;
}

/** Second line of a file row: drafts, change kind, patch state and the viewed source. */
export function fileRowDetail(file: PullRequestFile, draftCount: number, host: string): string {
  const parts = [
    draftCount === 0 ? null : `${String(draftCount)} ${draftCount === 1 ? "draft" : "drafts"}`,
    changeNote(file),
    file.patch.state === "present" ? null : PATCH_STATE_NOTES[file.patch.state],
    file.viewed.viewed
      ? file.viewed.source === "forge"
        ? `viewed on ${host}`
        : "viewed on this companion"
      : null,
  ];
  return parts.filter((part) => part !== null).join(" · ");
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
      locations.set(hunk.id, { line: Math.max(1, hunk.newStart), path: file.path });
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
