import type { DiffDisplay } from "./diffDisplay";
import { StyleSheet, View } from "react-native";

import type { PullRequestFile } from "../../../data/forgeMutationContract";
import type { DraftComment } from "../../../data/reviewDraftContract";
import type { DraftPut } from "../../../data/reviewDraftPuts";
import type { LineCommentTarget } from "../../review/comments/LineCommentComposer";
import type { CodeReviewLineReference } from "../../review/comments/reviewComment";
import { CodeReviewEditor } from "../../review/editor/CodeReviewEditor";
import {
  codeReviewWorkspaceRevision,
  type CodeReviewDocument,
  type CodeReviewFileItem,
} from "../../review/editor/editorBridge";
import { draftEditorComments, fileDocument } from "./changesPresentation";

const BYTES_PER_MEGABYTE = 1_048_576;
/** Keeps a short diff usable when the drafts list below it is long. */
const MIN_DIFF_HEIGHT = 160;

/** The PR file tree shown with the diff. */
export type DiffTree = {
  /** The tree sits beside the diff rather than taking its place. */
  readonly besideDiff: boolean;
  readonly complete: boolean;
  readonly files: readonly PullRequestFile[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (path: string) => void;
  readonly open: boolean;
};

const TREE_STATUS: Readonly<Record<PullRequestFile["status"], CodeReviewFileItem["status"]>> = {
  added: "added",
  copied: "added",
  modified: "modified",
  removed: "deleted",
  renamed: "renamed",
};

/**
 * The PR's files in the Pierre review editor: its file tree (type icons,
 * change status, line statistics and draft count) beside or instead of the
 * selected file's diff. An explicit expansion supplies an aligned whole-file
 * document; otherwise the recorded patch is immediately available. Drafts show inline, new
 * ones at once while they are saved; a line tap opens the one native line
 * composer and the line stays highlighted as its anchor. Files without a
 * patch say why.
 */
export function PullRequestDiff({
  composerLine,
  display,
  draftPuts,
  drafts,
  expandedDocument,
  onCommentPress,
  onLinePress,
  reveal,
  selected,
  tree,
}: {
  /** The line whose composer is open, or `null`. */
  readonly composerLine: LineCommentTarget | null;
  readonly display: DiffDisplay;
  readonly draftPuts: readonly DraftPut[];
  readonly drafts: readonly DraftComment[];
  /** The explicitly expanded file with inline changes. */
  readonly expandedDocument?: CodeReviewDocument | undefined;
  readonly onCommentPress?: (id: string) => void;
  readonly onLinePress: (reference: CodeReviewLineReference) => void;
  readonly reveal: CodeReviewLineReference | null;
  readonly selected: PullRequestFile;
  /** The PR's file tree; `null` shows the one file alone (guide stops). */
  readonly tree: DiffTree | null;
}): React.JSX.Element {
  const document = expandedDocument ?? selectedDocument(selected);
  const navigation = tree ?? {
    besideDiff: false,
    complete: true,
    files: [selected],
    onOpenChange: undefined,
    onSelect: () => undefined,
    open: false,
  };
  const items = navigation.files.map((file) => treeItem(file, drafts, draftPuts));
  return (
    <View style={styles.editor} testID="pull-request-diff">
      <CodeReviewEditor
        comments={draftEditorComments(drafts, draftPuts, selected.path)}
        compact={!navigation.besideDiff}
        document={document}
        files={items}
        filesComplete={navigation.complete}
        loadError={null}
        loading={false}
        mode={display.mode}
        onCommentPress={onCommentPress}
        onFileSelect={navigation.onSelect}
        onFilesOpenChange={navigation.onOpenChange}
        onLinePress={onLinePress}
        revealReference={reveal}
        selectedPath={selected.path}
        selectedReference={composerLine}
        showLineNumbers={display.showNumbers}
        sidebarOpen={navigation.open}
        workspaceRevision={codeReviewWorkspaceRevision(items)}
        wrapLines={display.wrapLines}
      />
    </View>
  );
}

function selectedDocument(file: PullRequestFile): CodeReviewDocument {
  return (
    fileDocument(file) ?? {
      detail: missingPatchReason(file),
      displayState: "unsupported" as const,
      patches: [] as const,
      path: file.path,
      revision: `missing:${file.path}:${file.patch.state}`,
      source: "" as const,
    }
  );
}

function treeItem(
  file: PullRequestFile,
  drafts: readonly DraftComment[],
  puts: readonly DraftPut[],
): CodeReviewFileItem {
  return {
    additions: file.additions,
    deletions: file.deletions,
    path: file.path,
    review: {
      drafts:
        drafts.filter((draft) => draft.anchor.path === file.path).length +
        puts.filter((put) => put.draft.anchor.path === file.path).length,
    },
    status: TREE_STATUS[file.status],
    treePath: file.path,
  };
}

function missingPatchReason(file: PullRequestFile): string {
  if (file.patch.state === "tooLarge") {
    return `Too large to render${file.patch.bytes === null ? "" : ` (${String(Math.ceil(file.patch.bytes / BYTES_PER_MEGABYTE))} MB)`}`;
  }
  return file.patch.state === "binary" ? "Binary file" : "No patch provided by the forge";
}

const styles = StyleSheet.create({
  editor: {
    flex: 1,
    minHeight: MIN_DIFF_HEIGHT,
  },
});
