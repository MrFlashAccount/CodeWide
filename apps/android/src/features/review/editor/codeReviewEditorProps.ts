import type { CodeReviewLineReference } from "../comments/reviewComment";
import type {
  CodeReviewDocument,
  CodeReviewFileItem,
  CodeReviewInlineComment,
  CodeReviewViewMode,
} from "./editorBridge";

/** The one props contract of the native and web review editor adapters. */
export type CodeReviewEditorProps = {
  readonly comments: readonly CodeReviewInlineComment[];
  readonly compact: boolean;
  readonly document: CodeReviewDocument | null;
  readonly files: readonly CodeReviewFileItem[];
  readonly loadError: string | null;
  readonly loading: boolean;
  readonly mode: CodeReviewViewMode;
  readonly onCommentPress?: ((id: string) => void) | undefined;
  readonly onFileSelect: (path: string) => void;
  readonly onFilesOpenChange?: ((open: boolean) => void) | undefined;
  /** A line was tapped; the owner opens its line composer. */
  readonly onLinePress: (reference: CodeReviewLineReference) => void;
  readonly onRetryLoad?: () => void;
  readonly revealReference: CodeReviewLineReference | null;
  readonly selectedPath: string | null;
  /** The line whose composer is open, highlighted as its anchor; `null` while none is. */
  readonly selectedReference: CodeReviewLineReference | null;
  readonly sidebarOpen: boolean;
  readonly workspaceRevision: string;
  readonly wrapLines: boolean;
};
