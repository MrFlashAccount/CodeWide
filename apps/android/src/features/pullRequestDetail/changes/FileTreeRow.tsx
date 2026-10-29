import { Pressable, StyleSheet, View } from "react-native";

import type { PullRequestFile } from "../../../data/forgeMutationContract";
import { colors, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { DiffCounts, ViewedToggle } from "./FileMarks";
import { TREE_ROW_HEIGHT, type FileTreeProps } from "./fileTreeContract";

/** Changed files sharing one directory, in the forge's order. */
export type Directory = { readonly files: PullRequestFile[]; readonly path: string };

const DIRECTORY_ROW_HEIGHT = 24;

/** A directory line and its file rows. */
export function DirectoryGroup({
  directory,
  props,
}: {
  readonly directory: Directory;
  readonly props: FileTreeProps;
}): React.JSX.Element {
  return (
    <View>
      {directory.path === "" ? null : (
        <Text ellipsizeMode="head" numberOfLines={1} style={styles.directory}>
          {directory.path}
        </Text>
      )}
      {directory.files.map((file) => (
        <FileRow
          draftCount={props.drafts.filter((draft) => draft.anchor.path === file.path).length}
          file={file}
          host={props.host}
          key={file.path}
          nested={directory.path !== ""}
          onSelect={props.onSelect}
          onToggleViewed={props.onToggleViewed}
          selected={props.selectedPath === file.path}
          viewedPending={props.viewedPending.has(file.path)}
        />
      ))}
    </View>
  );
}

const STATUS_GLYPHS: Readonly<Record<PullRequestFile["status"], string>> = {
  added: "A",
  copied: "C",
  modified: "M",
  removed: "D",
  renamed: "R",
};

function FileRow({
  draftCount,
  file,
  host,
  nested,
  onSelect,
  onToggleViewed,
  selected,
  viewedPending,
}: {
  readonly draftCount: number;
  readonly file: PullRequestFile;
  readonly host: string;
  readonly nested: boolean;
  readonly onSelect: (file: PullRequestFile) => void;
  readonly onToggleViewed: (file: PullRequestFile) => void;
  readonly selected: boolean;
  readonly viewedPending: boolean;
}): React.JSX.Element {
  return (
    <View
      style={[styles.row, nested && styles.nested, selected && styles.selected]}
      testID={`pr-file-${file.path}`}
    >
      <ViewedToggle
        file={file}
        host={host}
        onToggle={() => {
          onToggleViewed(file);
        }}
        pending={viewedPending}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={() => {
          onSelect(file);
        }}
        style={styles.body}
      >
        <Text style={[styles.status, file.status === "removed" && styles.removed]}>
          {STATUS_GLYPHS[file.status]}
        </Text>
        <Text
          ellipsizeMode="middle"
          numberOfLines={1}
          style={[styles.name, file.viewed.viewed && !selected && styles.nameViewed]}
        >
          {file.path.slice(file.path.lastIndexOf("/") + 1)}
        </Text>
        {draftCount === 0 ? null : <Text style={styles.drafts}>{`✎${String(draftCount)}`}</Text>}
        <DiffCounts file={file} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    alignItems: "center",
    columnGap: spacing.xs,
    flex: 1,
    flexDirection: "row",
    height: TREE_ROW_HEIGHT,
    minWidth: 0,
  },
  directory: {
    ...typeScale.label,
    color: colors.textMuted,
    fontFamily: "monospace",
    lineHeight: DIRECTORY_ROW_HEIGHT,
    paddingHorizontal: spacing.xs,
  },
  drafts: {
    ...typeScale.label,
    color: colors.primary,
  },
  name: {
    ...typeScale.label,
    color: colors.text,
    flex: 1,
    fontFamily: "monospace",
  },
  nameViewed: {
    color: colors.textMuted,
  },
  nested: {
    paddingLeft: spacing.md,
  },
  removed: {
    color: colors.error,
  },
  row: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    paddingHorizontal: spacing.xs,
  },
  selected: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  status: {
    ...typeScale.caption,
    color: colors.textMuted,
    fontFamily: "monospace",
  },
});
