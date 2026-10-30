import { StyleSheet, View } from "react-native";

import type { PullRequestFile } from "../../../data/forgeMutationContract";
import type { DraftComment } from "../../../data/reviewDraftContract";
import type { CodeReviewLineReference } from "../../review/comments/reviewComment";
import { CodeReviewEditor } from "../../review/editor/CodeReviewEditor";
import {
  codeReviewWorkspaceRevision,
  type CodeReviewFileItem,
} from "../../review/editor/editorBridge";
import { draftEditorComments, fileDocument, wholeFileDocument } from "./changesPresentation";

const BYTES_PER_MEGABYTE = 1_048_576;
/** Keeps a short diff usable when the drafts list below it is long. */
const MIN_DIFF_HEIGHT = 160;

/** The PR file tree shown with the diff. */
export type DiffTree = {
  /** The tree sits beside the diff rather than taking its place. */
  readonly besideDiff: boolean;
  readonly files: readonly PullRequestFile[];
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
 * change status, viewed mark and draft count) beside or instead of the
 * selected file's diff. Once the whole head file is read and lines up with the
 * patch, the diff is that whole file with the changes inline; until then, and
 * whenever it cannot be shown, it is the recorded patch. Drafts show inline; a
 * line tap opens the comment sheet instead of an inline composer. Files
 * without a patch say why.
 */
export function PullRequestDiff({
  drafts,
  headContent,
  onLinePress,
  reveal,
  selected,
  tree,
}: {
  readonly drafts: readonly DraftComment[];
  /** The selected file's whole head content; `null` shows the recorded patch. */
  readonly headContent: string | null;
  readonly onLinePress: (reference: CodeReviewLineReference) => void;
  readonly reveal: CodeReviewLineReference | null;
  readonly selected: PullRequestFile;
  /** The PR's file tree; `null` shows the one file alone (guide stops). */
  readonly tree: DiffTree | null;
}): React.JSX.Element {
  const document = (headContent === null ? null : wholeFileDocument(selected, headContent)) ??
    fileDocument(selected) ?? {
      detail: missingPatchReason(selected),
      displayState: "unsupported" as const,
      patches: [] as const,
      path: selected.path,
      revision: `missing:${selected.path}:${selected.patch.state}`,
      source: "" as const,
    };
  const items = (tree === null ? [selected] : tree.files).map((file) => treeItem(file, drafts));
  return (
    <View style={styles.editor} testID="pull-request-diff">
      <CodeReviewEditor
        commentDraft=""
        comments={draftEditorComments(drafts, selected.path)}
        compact={tree === null || !tree.besideDiff}
        document={document}
        files={items}
        loadError={null}
        loading={false}
        mode="unified"
        onCommentDraftChange={() => undefined}
        onCommentSelectionChange={() => undefined}
        onCommentSubmit={() => undefined}
        onFileSelect={tree === null ? () => undefined : tree.onSelect}
        onLinePress={onLinePress}
        onVoicePress={() => undefined}
        revealReference={reveal}
        selectedPath={selected.path}
        selectedReference={null}
        sidebarOpen={tree !== null && tree.open}
        voiceError={null}
        voicePermissionGranted={false}
        voicePhase="idle"
        voiceRetryAvailable={false}
        workspaceRevision={codeReviewWorkspaceRevision(items)}
        wrapLines={false}
      />
    </View>
  );
}

function treeItem(file: PullRequestFile, drafts: readonly DraftComment[]): CodeReviewFileItem {
  return {
    additions: file.additions,
    deletions: file.deletions,
    path: file.path,
    review: {
      drafts: drafts.filter((draft) => draft.anchor.path === file.path).length,
      viewed: file.viewed.viewed,
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
