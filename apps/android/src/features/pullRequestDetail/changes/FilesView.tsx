import type { DiffDisplay } from "./diffDisplay";
import { StyleSheet, View } from "react-native";

import type { PullRequestFile, PullRequestFilesPage } from "../../../data/forgeMutationContract";
import type { DraftComment } from "../../../data/reviewDraftContract";
import type { DraftPut } from "../../../data/reviewDraftPuts";
import type { LineCommentTarget } from "../../review/comments/LineCommentComposer";
import { colors, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import type { CodeReviewLineReference } from "../../review/comments/reviewComment";
import { canEditDraft } from "./changesPresentation";
import type { FilesFailure } from "./filesFailure";
import { FileDrafts } from "./FileDrafts";
import type { FileExpansion } from "./useFileExpansion";
import { PullRequestDiff } from "./PullRequestDiff";

/** Everything the files view needs. */
type FilesViewProps = {
  readonly besideDiff: boolean;
  /** The line whose composer is open, highlighted in the diff. */
  readonly composerLine: LineCommentTarget | null;
  readonly display: DiffDisplay;
  readonly draftPuts: readonly DraftPut[];
  readonly drafts: readonly DraftComment[];
  readonly expansion: FileExpansion;
  readonly filesOpen: boolean;
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
  return (
    <View style={styles.fill}>
      {props.filesOpen ? <TreeHeader {...props} /> : null}
      {(props.expansion.state === "unavailable" || props.expansion.state === "failed") && (
        <Text accessibilityLiveRegion="polite" style={styles.notice}>
          {props.expansion.reason}
        </Text>
      )}
      {selected === null ? null : <SelectedFileDiff {...props} selected={selected} />}
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

function SelectedFileDiff(
  props: FilesViewProps & { readonly selected: PullRequestFile },
): React.JSX.Element {
  return (
    <PullRequestDiff
      composerLine={props.composerLine}
      display={props.display}
      draftPuts={props.draftPuts}
      drafts={props.drafts}
      expandedDocument={props.expansion.state === "expanded" ? props.expansion.document : undefined}
      onCommentPress={(id) => {
        const draft = props.drafts.find((d) => d.id === id);
        if (draft !== undefined && canEditDraft(draft)) {
          props.onEditDraft(draft);
        }
      }}
      onLinePress={props.onLinePress}
      reveal={props.composerLine}
      selected={props.selected}
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
  notice: {
    ...typeScale.label,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
  },
  summary: {
    ...typeScale.label,
    color: colors.textMuted,
    flex: 1,
  },
});
