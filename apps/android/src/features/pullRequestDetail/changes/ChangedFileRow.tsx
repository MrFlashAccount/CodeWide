import { Pressable, StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { PullRequestFile } from "../../../data/forgeMutationContract";
import { colors, controlHitSlop, controlSize, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { OverflowActionsMenu } from "../actions/OverflowActionsMenu";
import { fileRowDetail, viewedLabel } from "./changesPresentation";

/**
 * One changed file: Viewed toggle (an explicit forge write), path with middle
 * ellipsis, detail line, +/− counts and the file's anchored actions behind ⋯.
 */
export function ChangedFileRow({
  actions,
  draftCount,
  file,
  host,
  onRun,
  onSelect,
  onToggleViewed,
  selected,
  viewedPending,
}: {
  readonly actions: readonly ActionDescriptor[];
  readonly draftCount: number;
  readonly file: PullRequestFile;
  readonly host: string;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly onSelect: (file: PullRequestFile) => void;
  readonly onToggleViewed: (file: PullRequestFile) => void;
  readonly selected: boolean;
  readonly viewedPending: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.row, selected && styles.selected]} testID={`pr-file-${file.path}`}>
      <Pressable
        accessibilityLabel={
          file.viewed.viewed ? `${viewedLabel(file, host)}. Mark not viewed` : "Mark viewed"
        }
        accessibilityRole="checkbox"
        accessibilityState={{ busy: viewedPending, checked: file.viewed.viewed }}
        disabled={viewedPending}
        hitSlop={controlHitSlop.compact}
        onPress={() => {
          onToggleViewed(file);
        }}
        style={styles.check}
      >
        <Text style={[styles.checkGlyph, file.viewed.viewed && styles.checked]}>
          {file.viewed.viewed ? "✓" : "○"}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={() => {
          onSelect(file);
        }}
        style={styles.body}
      >
        <Text ellipsizeMode="middle" numberOfLines={1} style={styles.path}>
          {file.path}
        </Text>
        <Text numberOfLines={1} style={styles.detail}>
          {fileRowDetail(file, draftCount, host)}
        </Text>
      </Pressable>
      <Text style={styles.added}>{file.additions > 0 ? `+${String(file.additions)}` : ""}</Text>
      <Text style={styles.removed}>{file.deletions > 0 ? `−${String(file.deletions)}` : ""}</Text>
      <OverflowActionsMenu
        accessibilityLabel={`Actions for ${file.path}`}
        actions={actions}
        compact
        onRun={onRun}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  added: {
    ...typeScale.label,
    color: colors.success,
    fontVariant: ["tabular-nums"],
  },
  body: {
    flex: 1,
    justifyContent: "center",
    minHeight: controlSize.touch,
    minWidth: 0,
  },
  check: {
    alignItems: "center",
    height: controlSize.compact,
    justifyContent: "center",
    width: controlSize.compact,
  },
  checked: {
    color: colors.success,
  },
  checkGlyph: {
    ...typeScale.title,
    color: colors.textMuted,
  },
  detail: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  path: {
    ...typeScale.code,
    color: colors.text,
  },
  removed: {
    ...typeScale.label,
    color: colors.error,
    fontVariant: ["tabular-nums"],
  },
  row: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    paddingHorizontal: spacing.sm,
  },
  selected: {
    backgroundColor: colors.surfaceContainer,
  },
});
