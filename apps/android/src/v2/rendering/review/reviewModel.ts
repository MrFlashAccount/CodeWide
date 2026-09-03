export type ReviewScope = "branch" | "lastTurn" | "session" | "staged" | "unstaged";

export type ReviewViewMode = "source" | "split" | "unified";
export type ReviewDelivery = "detached" | "inline";
export type ReviewStartKind = ReviewStartTarget["kind"];

export type ReviewStartTarget =
  | { kind: "uncommitted" }
  | { branch: string; kind: "baseBranch" }
  | { kind: "commit"; sha: string }
  | { instructions: string; kind: "custom" };

export interface ReviewTarget {
  id: string;
  label: string;
  reference: string | null;
}

export interface ReviewLineAnchor {
  kind: "line";
  target: ReviewTarget;
  path: string;
  line: number;
  side: "new" | "old";
  context: string;
}

interface ReviewResponseAnchor {
  kind: "response";
  target: ReviewTarget;
}

interface ReviewTextAnchor {
  kind: "text";
  target: ReviewTarget;
  blockPath: string;
  quote: string;
  start: number;
  end: number;
}

interface ReviewDiagramAnchor {
  diagramId: string;
  kind: "diagram";
  source: string;
  target: ReviewTarget;
  x: number;
  y: number;
}

export type ReviewAnchor =
  | ReviewDiagramAnchor
  | ReviewLineAnchor
  | ReviewResponseAnchor
  | ReviewTextAnchor;

export interface ReviewComment {
  id: string;
  anchor: ReviewAnchor;
  body: string;
  order: number;
}

export interface ReviewFile {
  additions: number;
  deletions: number;
  kind: "add" | "delete" | "update";
  path: string;
}

export interface ReviewDiffLine {
  anchor: ReviewLineAnchor | null;
  kind: "added" | "context" | "deleted" | "header";
  newLine: number | null;
  oldLine: number | null;
  text: string;
}

export interface ReviewSplitLine {
  key: string;
  left: ReviewDiffLine | null;
  right: ReviewDiffLine | null;
}

export function reviewResponseTarget(turnId: string, itemId: string): ReviewTarget {
  return {
    id: `agent-response:${turnId}:${itemId}`,
    label: "Completed agent response",
    reference: `${turnId}:${itemId}`,
  };
}

export function reviewFileTarget(path: string): ReviewTarget {
  return { id: `changed-file:${path}`, label: path, reference: path };
}
