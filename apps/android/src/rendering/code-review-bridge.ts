import type { CodeReviewComment, CodeReviewLineReference } from "./code-review";

export const CODE_REVIEW_BRIDGE_VERSION = 1 as const;

export type CodeReviewViewMode = "source" | "unified" | "split";

export type CodeReviewPatch = {
  kind: "add" | "delete" | "update";
  diff: string;
};

/**
 * Immutable file snapshot. The WebView owns Pierre-specific materialization;
 * React never projects line rows or duplicates before/after documents.
 */
export type CodeReviewDocument = {
  path: string;
  source: string;
  patches: readonly CodeReviewPatch[];
  displayState?: "deleted" | "empty";
  revision: string;
};

export type CodeReviewFileItem = {
  path: string;
  treePath: string;
  status: "added" | "deleted" | "modified";
  additions: number;
  deletions: number;
  sourceOnly?: boolean;
};

export type CodeReviewWorkspaceState = {
  files: readonly CodeReviewFileItem[];
  revision: string;
  selectedPath: string | null;
  sidebarOpen: boolean;
  compact: boolean;
};

export type CodeReviewComposerState = {
  reference: CodeReviewLineReference;
  draft: string;
  voicePhase: "idle" | "starting" | "recording" | "finishing";
  voiceRetryAvailable: boolean;
  voiceError: string | null;
};

export type CodeReviewHostCommand =
  | BridgeCommand<"document", { requestId: number; document: CodeReviewDocument | null }>
  | BridgeCommand<"workspace", CodeReviewWorkspaceState>
  | BridgeCommand<"comments", readonly CodeReviewComment[]>
  | BridgeCommand<"composer", CodeReviewComposerState | null>
  | BridgeCommand<"settings", { mode: CodeReviewViewMode; wrapLines: boolean }>
  | BridgeCommand<"reveal", CodeReviewLineReference>;

export type CodeReviewClientEvent =
  | BridgeEvent<"ready">
  | BridgeEvent<"rendered", { requestId: number; renderMs: number }>
  | BridgeEvent<"fileSelect", { requestId: number; path: string }>
  | BridgeEvent<"lineTap", { requestId: number; reference: CodeReviewLineReference }>
  | BridgeEvent<"draftChanged", { requestId: number; draft: string; selectionStart: number; selectionEnd: number }>
  | BridgeEvent<"commentSubmit", { requestId: number; reference: CodeReviewLineReference; draft: string }>
  | BridgeEvent<"voiceAction", { requestId: number; reference: CodeReviewLineReference; draft: string; selectionStart: number; selectionEnd: number }>
  | BridgeEvent<"diffUnavailable", { requestId: number; message: string }>
  | BridgeEvent<"error", { requestId: number; message: string }>;

type BridgeCommand<TCommand extends string, TPayload> = {
  version: typeof CODE_REVIEW_BRIDGE_VERSION;
  sequence: number;
  command: TCommand;
  payload: TPayload;
};

type BridgeEvent<TType extends string, TPayload extends Record<string, unknown> = Record<never, never>> = {
  version: typeof CODE_REVIEW_BRIDGE_VERSION;
  type: TType;
} & TPayload;

export function codeReviewWorkspaceRevision(files: readonly CodeReviewFileItem[]): string {
  return files.map((file) => `${file.treePath}\u0000${file.status}\u0000${file.additions}\u0000${file.deletions}\u0000${file.sourceOnly === true ? 1 : 0}`).join("\u0001");
}

export function codeReviewDocumentRevision(
  path: string,
  source: string,
  patches: readonly CodeReviewPatch[],
  displayState?: CodeReviewDocument["displayState"],
): string {
  let hash = 0x811c9dc5;
  const append = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  append(path);
  append(source);
  append(displayState ?? "content");
  for (const patch of patches) {
    append(patch.kind);
    append(patch.diff);
  }
  return `${path}:${source.length}:${patches.length}:${(hash >>> 0).toString(36)}`;
}
