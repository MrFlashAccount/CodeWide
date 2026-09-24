import type { CodeReviewComment, CodeReviewLineReference } from "../comments/reviewComment";

export const CODE_REVIEW_BRIDGE_VERSION = 1 as const;

export type CodeReviewViewMode = "source" | "unified" | "split";

export type CodeReviewPatch = {
  diff: string;
  kind: "add" | "delete" | "update";
};

/**
 * Immutable file snapshot. The WebView owns Pierre-specific materialization;
 * React never projects line rows or duplicates before/after documents.
 */
export type CodeReviewDocument = {
  displayState?: "deleted" | "empty";
  /** Session and VCS scopes retain the complete file when patch reconstruction fails. */
  fullFileDiff?: boolean;
  patches: readonly CodeReviewPatch[];
  path: string;
  revision: string;
  source: string;
};

export type CodeReviewFileItem = {
  additions: number;
  deletions: number;
  path: string;
  sourceOnly?: boolean;
  status: "added" | "deleted" | "modified";
  treePath: string;
};

export type CodeReviewWorkspaceState = {
  compact: boolean;
  files: readonly CodeReviewFileItem[];
  revision: string;
  selectedPath: string | null;
  sidebarOpen: boolean;
};

export type CodeReviewComposerState = {
  draft: string;
  reference: CodeReviewLineReference;
  voiceError: string | null;
  voicePermissionGranted: boolean;
  voicePhase: "idle" | "starting" | "recording" | "finishing";
  voiceRetryAvailable: boolean;
};

export type CodeReviewHostCommand =
  | BridgeCommand<"document", { document: CodeReviewDocument | null; requestId: number }>
  | BridgeCommand<"workspace", CodeReviewWorkspaceState>
  | BridgeCommand<"comments", readonly CodeReviewComment[]>
  | BridgeCommand<"composer", CodeReviewComposerState | null>
  | BridgeCommand<"settings", { mode: CodeReviewViewMode; wrapLines: boolean }>
  | BridgeCommand<"reveal", CodeReviewLineReference>;

export type CodeReviewClientEvent =
  | BridgeEvent<"ready">
  | BridgeEvent<"rendered", { renderMs: number; requestId: number }>
  | BridgeEvent<"fileSelect", { path: string; requestId: number }>
  | BridgeEvent<"lineTap", { reference: CodeReviewLineReference; requestId: number }>
  | BridgeEvent<
      "draftChanged",
      {
        draft: string;
        reference: CodeReviewLineReference;
        requestId: number;
        selectionEnd: number;
        selectionStart: number;
      }
    >
  | BridgeEvent<
      "commentSubmit",
      { draft: string; reference: CodeReviewLineReference; requestId: number }
    >
  | BridgeEvent<
      "voiceAction",
      {
        draft: string;
        reference: CodeReviewLineReference;
        requestId: number;
        selectionEnd: number;
        selectionStart: number;
      }
    >
  | BridgeEvent<"diffUnavailable", { message: string; requestId: number }>
  | BridgeEvent<"error", { message: string; requestId: number }>;

type BridgeCommand<TCommand extends string, TPayload> = {
  command: TCommand;
  payload: TPayload;
  sequence: number;
  version: typeof CODE_REVIEW_BRIDGE_VERSION;
};

type BridgeEvent<
  TType extends string,
  TPayload extends Record<string, unknown> = Record<never, never>,
> = {
  type: TType;
  version: typeof CODE_REVIEW_BRIDGE_VERSION;
} & TPayload;

export function codeReviewWorkspaceRevision(files: readonly CodeReviewFileItem[]): string {
  return files
    .map(
      (file) =>
        `${file.treePath}\u0000${file.status}\u0000${String(file.additions)}\u0000${String(file.deletions)}\u0000${String(file.sourceOnly === true ? 1 : 0)}`,
    )
    .join("\u0001");
}

export function codeReviewDocumentRevision(
  path: string,
  source: string,
  patches: readonly CodeReviewPatch[],
  displayState?: CodeReviewDocument["displayState"],
): string {
  let hash = 0x81_1c_9d_c5;
  const append = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01_00_01_93);
    }
  };
  append(path);
  append(source);
  append(displayState ?? "content");
  for (const patch of patches) {
    append(patch.kind);
    append(patch.diff);
  }
  return `${path}:${String(source.length)}:${String(patches.length)}:${(hash >>> 0).toString(36)}`;
}
