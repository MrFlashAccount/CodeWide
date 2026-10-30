import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import type { PullRequestFile, PullRequestFilesPage } from "../../../data/forgeMutationContract";
import type { DraftComment } from "../../../data/reviewDraftContract";
import { colors, controlHitSlop, iconSize, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import type { CodeReviewLineReference } from "../../review/comments/reviewComment";
import { viewedSummary } from "./changesPresentation";
import { FileDrafts } from "./FileDrafts";
import { PullRequestDiff } from "./PullRequestDiff";

/** Everything the files view needs. */
type FilesViewProps = {
  readonly besideDiff: boolean;
  readonly drafts: readonly DraftComment[];
  readonly filesOpen: boolean;
  /** The selected file's whole head content once read; `null` keeps the patch view. */
  readonly headContent: string | null;
  readonly host: string;
  readonly onDeleteDraft: (draft: DraftComment) => void;
  readonly onGuide: () => void;
  readonly onLinePress: (reference: CodeReviewLineReference) => void;
  readonly onLoadMore: (() => void) | null;
  readonly onReanchor: (draft: DraftComment) => void;
  readonly onSelect: (path: string) => void;
  readonly onSendToAgent: (draft: DraftComment) => void;
  readonly page: PullRequestFilesPage;
  readonly selected: PullRequestFile | null;
};

/**
 * Files view: the Pierre file tree beside the selected file's diff where the
 * pane is wide enough, otherwise instead of it, under a header with the viewed
 * summary and the review guide entry; the file's drafts fold under the diff.
 */
export function FilesView(props: FilesViewProps): React.JSX.Element {
  const { selected } = props;
  return (
    <View style={styles.fill}>
      {props.filesOpen ? <TreeHeader {...props} /> : null}
      {selected === null ? null : (
        <PullRequestDiff
          drafts={props.drafts}
          headContent={props.headContent}
          onLinePress={props.onLinePress}
          reveal={null}
          selected={selected}
          tree={{
            besideDiff: props.besideDiff,
            files: props.page.files,
            onSelect: props.onSelect,
            open: props.filesOpen,
          }}
        />
      )}
      {selected === null ? null : (
        <FileDrafts
          drafts={props.drafts.filter((draft) => draft.anchor.path === selected.path)}
          host={props.host}
          onDelete={props.onDeleteDraft}
          onReanchor={props.onReanchor}
          onSendToAgent={props.onSendToAgent}
        />
      )}
    </View>
  );
}

/** `✦ Guide · 3 of 24 viewed`, plus the forge's truncation note and Show more files. */
function TreeHeader(props: FilesViewProps): React.JSX.Element {
  const { page } = props;
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        hitSlop={controlHitSlop.compact}
        onPress={props.onGuide}
        style={styles.guide}
        testID="changes-view-guide"
      >
        <Ionicons color={colors.text} name="sparkles-outline" size={iconSize.inline} />
        <Text style={styles.guideLabel}>Guide</Text>
      </Pressable>
      <Text numberOfLines={1} style={styles.summary}>
        {page.truncated === null
          ? viewedSummary(page.files)
          : `${viewedSummary(page.files)} · forge shows ${String(page.truncated.shown)} of ${String(page.truncated.total)}`}
      </Text>
      {props.onLoadMore === null ? null : (
        <Text accessibilityRole="button" onPress={props.onLoadMore} style={styles.more}>
          Show more files
        </Text>
      )}
    </View>
  );
}

/** Matches the Pierre tree's compact row. */
const HEADER_HEIGHT = 30;

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    minHeight: 0,
  },
  guide: {
    alignItems: "center",
    columnGap: spacing.xxs,
    flexDirection: "row",
  },
  guideLabel: {
    ...typeScale.label,
    color: colors.text,
  },
  header: {
    alignItems: "center",
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.sm,
    flexDirection: "row",
    height: HEADER_HEIGHT,
    paddingHorizontal: spacing.sm,
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
