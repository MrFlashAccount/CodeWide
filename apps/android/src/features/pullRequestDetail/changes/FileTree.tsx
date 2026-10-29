import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import type { PullRequestFile } from "../../../data/forgeMutationContract";
import { colors, controlHitSlop, iconSize, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { viewedSummary } from "./changesPresentation";
import { TREE_ROW_HEIGHT, type FileTreeProps } from "./fileTreeContract";
import { DirectoryGroup, type Directory } from "./FileTreeRow";

/** Files grouped under their directory, in the forge's order of first appearance. */
function directories(files: readonly PullRequestFile[]): readonly Directory[] {
  const groups = new Map<string, PullRequestFile[]>();
  for (const file of files) {
    const path = file.path.slice(0, Math.max(0, file.path.lastIndexOf("/")));
    const group = groups.get(path);
    if (group === undefined) {
      groups.set(path, [file]);
    } else {
      group.push(file);
    }
  }
  return Array.from(groups, ([path, grouped]) => ({ files: grouped, path }));
}

/**
 * IDE-style changed-files tree under its header (viewed summary and the
 * review guide entry): one dense row per file under a directory line, with
 * the viewed mark, draft count and +/− counts. Selecting a row opens its
 * diff; the viewed mark is an explicit forge write.
 */
export function FileTree(props: FileTreeProps): React.JSX.Element {
  return (
    <View style={[styles.column, props.overlay && styles.overlay]} testID="pr-file-tree">
      <TreeHeader files={props.page.files} onGuide={props.onGuide} />
      <TreeRows {...props} />
    </View>
  );
}

function TreeHeader({
  files,
  onGuide,
}: {
  readonly files: readonly PullRequestFile[];
  readonly onGuide: () => void;
}): React.JSX.Element {
  return (
    <View style={styles.header}>
      <Text numberOfLines={1} style={styles.summary}>
        {viewedSummary(files)}
      </Text>
      <Pressable
        accessibilityRole="button"
        hitSlop={controlHitSlop.compact}
        onPress={onGuide}
        style={styles.guide}
        testID="changes-view-guide"
      >
        <Ionicons color={colors.text} name="sparkles-outline" size={iconSize.inline} />
        <Text style={styles.guideLabel}>Guide</Text>
      </Pressable>
    </View>
  );
}

function TreeRows(props: FileTreeProps): React.JSX.Element {
  const { page } = props;
  return (
    <ScrollView style={styles.rows} testID="pr-file-list">
      {page.truncated === null ? null : (
        <Text style={styles.notice}>
          {`Showing ${String(page.truncated.shown)} of ${String(page.truncated.total)} files. The forge limits this diff; the guide covers the shown files only.`}
        </Text>
      )}
      {directories(page.files).map((directory) => (
        <DirectoryGroup directory={directory} key={directory.path} props={props} />
      ))}
      {props.onLoadMore === null ? null : (
        <Text accessibilityRole="button" onPress={props.onLoadMore} style={styles.notice}>
          Show more files
        </Text>
      )}
    </ScrollView>
  );
}

const TREE_COLUMN_WIDTH = 248;
const TREE_OVERLAY_WIDTH = 300;

const styles = StyleSheet.create({
  column: {
    backgroundColor: colors.conversationSurface,
    borderRightColor: colors.borderSoft,
    borderRightWidth: StyleSheet.hairlineWidth,
    width: TREE_COLUMN_WIDTH,
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
    flexDirection: "row",
    height: TREE_ROW_HEIGHT,
    paddingHorizontal: spacing.xs,
  },
  notice: {
    ...typeScale.label,
    color: colors.textMuted,
    padding: spacing.xs,
  },
  overlay: {
    maxWidth: "85%",
    width: TREE_OVERLAY_WIDTH,
  },
  rows: {
    flex: 1,
  },
  summary: {
    ...typeScale.label,
    color: colors.textMuted,
    flex: 1,
  },
});
