import { ScrollView, StyleSheet } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { PullRequestFile, PullRequestFilesPage } from "../../../data/forgeMutationContract";
import type { DraftComment } from "../../../data/reviewDraftContract";
import { colors, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { ChangedFileRow } from "./ChangedFileRow";

const PHONE_FILE_LIST_MAX_HEIGHT = 196;

/** Everything the file list needs. */
export type FileListProps = {
  readonly drafts: readonly DraftComment[];
  readonly fileActions: ReadonlyMap<string, readonly ActionDescriptor[]>;
  readonly host: string;
  readonly onLoadMore: (() => void) | null;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly onSelect: (file: PullRequestFile) => void;
  readonly onToggleViewed: (file: PullRequestFile) => void;
  readonly page: PullRequestFilesPage;
  readonly selectedPath: string | null;
  readonly tablet: boolean;
  readonly viewedPending: ReadonlySet<string>;
};

/**
 * Changed files form a horizontal work queue above the diff on wide screens;
 * phones retain a short vertical chooser above the same editor.
 */
export function FileList(props: FileListProps): React.JSX.Element {
  const { page } = props;
  return (
    <ScrollView
      contentContainerStyle={props.tablet ? styles.queueContent : undefined}
      horizontal={props.tablet}
      showsHorizontalScrollIndicator={false}
      style={props.tablet ? styles.queue : styles.phoneList}
      testID="pr-file-list"
    >
      {page.truncated === null ? null : (
        <Text style={styles.notice}>
          {`Showing ${String(page.truncated.shown)} of ${String(page.truncated.total)} files. The forge limits this diff; the guide covers the shown files only.`}
        </Text>
      )}
      {page.files.map((file) => (
        <ChangedFileRow
          actions={props.fileActions.get(file.path) ?? []}
          draftCount={props.drafts.filter((draft) => draft.anchor.path === file.path).length}
          file={file}
          horizontal={props.tablet}
          host={props.host}
          key={file.path}
          onRun={props.onRun}
          onSelect={props.onSelect}
          onToggleViewed={props.onToggleViewed}
          selected={props.selectedPath === file.path}
          viewedPending={props.viewedPending.has(file.path)}
        />
      ))}
      {props.onLoadMore === null ? null : (
        <Text accessibilityRole="button" onPress={props.onLoadMore} style={styles.notice}>
          Show more files
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  notice: {
    ...typeScale.label,
    color: colors.textMuted,
    padding: spacing.sm,
  },
  phoneList: {
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexGrow: 0,
    maxHeight: PHONE_FILE_LIST_MAX_HEIGHT,
  },
  queue: {
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexGrow: 0,
  },
  queueContent: {
    columnGap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
});
