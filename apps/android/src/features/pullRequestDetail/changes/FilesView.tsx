import type { DiffDisplay } from "./diffDisplay";
import { useDeferredValue } from "react";
import { StyleSheet, View } from "react-native";

import type { PullRequestFile, PullRequestFilesPage } from "../../../data/forgeMutationContract";
import type { DraftComment } from "../../../data/reviewDraftContract";
import type { DraftPut } from "../../../data/reviewDraftPuts";
import type { LineCommentTarget } from "../../review/comments/LineCommentComposer";
import { useConstant } from "../../../react/useConstant";
import { colors, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import type { CodeReviewLineReference } from "../../review/comments/reviewComment";
import { canEditDraft } from "./changesPresentation";
import type { FilesFailure } from "./filesFailure";
import { FileDrafts } from "./FileDrafts";
import { createHeadFileViews, type HeadFileSource, type HeadFileViews } from "./headFileViews";
import { PullRequestDiff } from "./PullRequestDiff";
import { useHeadFileContent } from "./useHeadFileContent";

/** Everything the files view needs. */
type FilesViewProps = {
  readonly besideDiff: boolean;
  /** The line whose composer is open, highlighted in the diff. */
  readonly composerLine: LineCommentTarget | null;
  readonly display: DiffDisplay;
  readonly draftPuts: readonly DraftPut[];
  readonly drafts: readonly DraftComment[];
  readonly filesOpen: boolean;
  /** Where the selected file's whole head content is read from. */
  readonly headFiles: HeadFileSource;
  readonly host: string;
  readonly onDeleteDraft: (draft: DraftComment) => void;
  readonly onDiscardPut: (put: DraftPut) => void;
  readonly onEditDraft: (draft: DraftComment) => void;
  readonly onEditPut: (put: DraftPut) => void;
  readonly onFilesOpenChange: (open: boolean) => void;
  readonly onLinePress: (reference: CodeReviewLineReference) => void;
  readonly onReanchor: (draft: DraftComment) => void;
  readonly onSelect: (path: string) => void;
  readonly onSendToAgent: (draft: DraftComment) => void;
  readonly page: PullRequestFilesPage;
  readonly selected: PullRequestFile | null;
  readonly treeFailure: FilesFailure | null;
};

/**
 * Files view: the Pierre file tree beside the selected file's diff where the
 * pane is wide enough, otherwise in its own sheet; the file's drafts fold under the diff.
 */
export function FilesView(props: FilesViewProps): React.JSX.Element {
  const { selected } = props;
  const views = useConstant(createHeadFileViews);
  return (
    <View style={styles.fill}>
      {props.filesOpen ? <TreeHeader {...props} /> : null}
      {selected === null ? null : <SelectedFileDiff {...props} selected={selected} views={views} />}
      {selected === null ? null : (
        <FileDrafts
          drafts={props.drafts.filter((draft) => draft.anchor.path === selected.path)}
          host={props.host}
          onDelete={props.onDeleteDraft}
          onDiscardPut={props.onDiscardPut}
          onEditPut={props.onEditPut}
          onReanchor={props.onReanchor}
          onSendToAgent={props.onSendToAgent}
          puts={props.draftPuts.filter((put) => put.draft.anchor.path === selected.path)}
        />
      )}
    </View>
  );
}

/**
 * The selected file's diff, decided once per file view. The selection is
 * deferred: while the next file's whole content is read (at most
 * `WHOLE_FILE_WAIT_MS`), its render suspends and the previous file stays on
 * screen; the first render of the view shows the editor's loading state.
 */
function SelectedFileDiff(
  props: FilesViewProps & { readonly selected: PullRequestFile; readonly views: HeadFileViews },
): React.JSX.Element {
  const shown = useDeferredValue<PullRequestFile | null>(props.selected, null);
  const content = useHeadFileContent({
    file: shown,
    files: props.page.files,
    source: props.headFiles,
    views: props.views,
  });
  return (
    <PullRequestDiff
      composerLine={props.composerLine}
      content={content}
      display={props.display}
      draftPuts={props.draftPuts}
      drafts={props.drafts}
      onCommentPress={(id) => {
        const draft = props.drafts.find((d) => d.id === id);
        if (draft !== undefined && canEditDraft(draft)) {
          props.onEditDraft(draft);
        }
      }}
      onLinePress={props.onLinePress}
      reveal={props.composerLine}
      selected={shown ?? props.selected}
      tree={{
        besideDiff: props.besideDiff,
        complete: props.page.nextCursor === null && props.page.truncated === null,
        files: props.page.files,
        onOpenChange: props.onFilesOpenChange,
        onSelect: props.onSelect,
        open: props.filesOpen,
      }}
    />
  );
}

/** Only a provider limit or a failed continuation needs a notice above the tree. */
function TreeHeader(props: FilesViewProps): React.JSX.Element | null {
  const { page, treeFailure } = props;
  if (page.truncated === null && treeFailure === null) {
    return null;
  }
  return (
    <View style={styles.header}>
      {page.truncated !== null && (
        <Text
          style={styles.summary}
        >{`Forge shows ${String(page.truncated.shown)} of ${String(page.truncated.total)} files`}</Text>
      )}
      {treeFailure !== null && (
        <>
          <Text style={styles.summary}>{treeFailure.message}</Text>
          <Text accessibilityRole="button" onPress={treeFailure.retry} style={styles.more}>
            Try again
          </Text>
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  fill: {
    flex: 1,
    minHeight: 0,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  more: {
    ...typeScale.label,
    color: colors.primary,
  },
  summary: {
    ...typeScale.label,
    color: colors.textMuted,
    flex: 1,
  },
});
