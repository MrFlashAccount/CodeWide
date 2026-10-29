import { Pressable, StyleSheet, View } from "react-native";

import type { PullRequestFile } from "../../../data/forgeMutationContract";
import type { DraftComment } from "../../../data/reviewDraftContract";
import { colors } from "../../../theme";
import type { CodeReviewLineReference } from "../../review/comments/reviewComment";
import { draftEditorComments } from "./changesPresentation";
import { FileDrafts } from "./FileDrafts";
import { FileTree } from "./FileTree";
import type { FileTreeProps } from "./fileTreeContract";
import { PullRequestDiff } from "./PullRequestDiff";

/** What the files view needs besides the tree's own props. */
type FilesViewProps = Omit<FileTreeProps, "overlay" | "selectedPath"> & {
  readonly besideDiff: boolean;
  readonly filesOpen: boolean;
  readonly onCloseFiles: () => void;
  readonly onDeleteDraft: (draft: DraftComment) => void;
  readonly onLinePress: (reference: CodeReviewLineReference) => void;
  readonly onReanchor: (draft: DraftComment) => void;
  readonly onSendToAgent: (draft: DraftComment) => void;
  readonly selected: PullRequestFile | null;
};

/**
 * Files view: the changed-files tree beside the selected file's diff where
 * the pane is wide enough, otherwise as a panel over it, with the file's
 * drafts folded under the diff.
 */
export function FilesView(props: FilesViewProps): React.JSX.Element {
  const { besideDiff, filesOpen, selected } = props;
  const tree = filesOpen ? (
    <FileTree {...props} overlay={!besideDiff} selectedPath={selected?.path ?? null} />
  ) : null;
  return (
    <View style={styles.row}>
      {besideDiff ? tree : null}
      <View style={styles.fill}>
        {selected === null ? null : <SelectedFile {...props} file={selected} />}
      </View>
      {besideDiff || tree === null ? null : (
        <TreeOverlay onClose={props.onCloseFiles} tree={tree} />
      )}
    </View>
  );
}

/** The selected file's diff with its drafts folded under it. */
function SelectedFile(
  props: FilesViewProps & { readonly file: PullRequestFile },
): React.JSX.Element {
  const { file } = props;
  return (
    <>
      <PullRequestDiff
        comments={draftEditorComments(props.drafts, file.path)}
        file={file}
        onLinePress={props.onLinePress}
        reveal={null}
      />
      <FileDrafts
        drafts={props.drafts.filter((draft) => draft.anchor.path === file.path)}
        host={props.host}
        onDelete={props.onDeleteDraft}
        onReanchor={props.onReanchor}
        onSendToAgent={props.onSendToAgent}
      />
    </>
  );
}

/** The tree as a panel over the diff; a tap beside it hides it. */
function TreeOverlay({
  onClose,
  tree,
}: {
  readonly onClose: () => void;
  readonly tree: React.JSX.Element;
}): React.JSX.Element {
  return (
    <View style={styles.overlay}>
      {tree}
      <Pressable
        accessibilityLabel="Hide files"
        accessibilityRole="button"
        onPress={onClose}
        style={styles.scrim}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    minWidth: 0,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    flexDirection: "row",
  },
  row: {
    flex: 1,
    flexDirection: "row",
    minHeight: 0,
  },
  scrim: {
    backgroundColor: colors.scrim,
    flex: 1,
  },
});
