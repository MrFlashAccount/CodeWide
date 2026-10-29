import type { PullRequestFile, PullRequestFilesPage } from "../../../data/forgeMutationContract";
import type { DraftComment } from "../../../data/reviewDraftContract";

/** Everything the file tree needs. */
export type FileTreeProps = {
  readonly drafts: readonly DraftComment[];
  readonly host: string;
  readonly onGuide: () => void;
  readonly onLoadMore: (() => void) | null;
  readonly onSelect: (file: PullRequestFile) => void;
  readonly onToggleViewed: (file: PullRequestFile) => void;
  /** A panel over the diff rather than a column beside it. */
  readonly overlay: boolean;
  readonly page: PullRequestFilesPage;
  readonly selectedPath: string | null;
  readonly viewedPending: ReadonlySet<string>;
};

/** Dense IDE row height; the whole row is the select target. */
export const TREE_ROW_HEIGHT = 30;
