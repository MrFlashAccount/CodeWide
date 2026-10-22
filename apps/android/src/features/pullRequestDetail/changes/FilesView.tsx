import { StyleSheet, View } from "react-native";

import type { PullRequestFile } from "../../../data/forgeMutationContract";
import type { DraftComment } from "../../../data/reviewDraftContract";
import type { CodeReviewLineReference } from "../../review/comments/reviewComment";
import { draftEditorComments } from "./changesPresentation";
import { FileDrafts } from "./FileDrafts";
import { FileList, type FileListProps } from "./FileList";
import { PullRequestDiff } from "./PullRequestDiff";

/** Files view: the file list and the selected file's diff with its drafts. */
export function FilesView(
  props: Omit<FileListProps, "selectedPath"> & {
    readonly onDeleteDraft: (draft: DraftComment) => void;
    readonly onLinePress: (reference: CodeReviewLineReference) => void;
    readonly onReanchor: (draft: DraftComment) => void;
    readonly onSendToAgent: (draft: DraftComment) => void;
    readonly selected: PullRequestFile | null;
  },
): React.JSX.Element {
  const { selected } = props;
  return (
    <View style={props.tablet ? styles.columns : styles.fill}>
      <FileList {...props} selectedPath={selected?.path ?? null} />
      <View style={styles.fill}>
        {selected === null ? null : (
          <PullRequestDiff
            comments={draftEditorComments(props.drafts, selected.path)}
            file={selected}
            onLinePress={props.onLinePress}
            reveal={null}
          />
        )}
        <FileDrafts
          drafts={
            selected === null
              ? []
              : props.drafts.filter((draft) => draft.anchor.path === selected.path)
          }
          host={props.host}
          onDelete={props.onDeleteDraft}
          onReanchor={props.onReanchor}
          onSendToAgent={props.onSendToAgent}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  columns: {
    flex: 1,
    flexDirection: "row",
  },
  fill: {
    flex: 1,
    minWidth: 0,
  },
});
