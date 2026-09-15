import { projectFileChange } from "./file-change-rendering";
import type { ThreadItem } from "@codewide/codex-protocol/v0.147.0/v2";

export interface TurnChangedFile {
  readonly path: string;
  readonly patch: string;
  readonly kind: "add" | "delete" | "update";
  readonly itemId: string;
  readonly additions: number;
  readonly deletions: number;
}

/** Keeps separate recorded edits; never invents a net diff from today's file. */
export function turnItemChanges(items: readonly ThreadItem[]): readonly TurnChangedFile[] {
  const files: TurnChangedFile[] = [];
  for (const item of items) {
    if (item.type !== "fileChange" || item.status !== "completed") continue;
    for (const change of item.changes) {
      const projection = projectFileChange(change.diff, change.kind);
      files.push({
        path: change.path,
        patch: projection.renderSource,
        kind: projection.kind,
        itemId: item.id,
        additions: projection.additions,
        deletions: projection.deletions,
      });
    }
  }
  return files;
}

/** Only the recorded turn diff is accepted: no worktree/current-file fallback. */
export function turnChangedFiles(diff: string): readonly TurnChangedFile[] {
  if (diff.trim() === "") return [];
  const sections = diff.split(/(?=^diff --git )/mu).filter((section) => section.trim() !== "");
  return sections.map((patch, index) => {
    const header = /^\+\+\+ (.+)$/mu.exec(patch)?.[1];
    const deleted = /^--- (.+)$/mu.exec(patch)?.[1];
    const rawPath = header === "/dev/null" ? deleted : header;
    const path = decodeDiffPath(rawPath ?? "Turn changes");
    const kind = deleted === "/dev/null" ? "add" : header === "/dev/null" ? "delete" : "update";
    const projection = projectFileChange(patch, kind);
    return {
      path,
      patch,
      kind: projection.kind,
      itemId: `recorded-diff:${index}`,
      additions: projection.additions,
      deletions: projection.deletions,
    };
  });
}

function decodeDiffPath(path: string): string {
  const unquoted = path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
  return unquoted.replace(/^[ab]\//u, "");
}
