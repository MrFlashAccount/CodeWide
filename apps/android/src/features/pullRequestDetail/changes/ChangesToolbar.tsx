import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { PullRequestFile } from "../../../data/forgeMutationContract";
import { colors, controlHitSlop, controlSize, iconSize, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { OverflowActionsMenu, type ExtraMenuItem } from "../actions/OverflowActionsMenu";
import { DiffCounts, ViewedToggle } from "./FileMarks";

/** The selected file and what the toolbar can do with it. */
export type ToolbarFile = {
  readonly actions: readonly ActionDescriptor[];
  readonly file: PullRequestFile;
  readonly next: (() => void) | null;
  readonly previous: (() => void) | null;
  readonly toggleViewed: () => void;
  readonly viewedPending: boolean;
};

/**
 * The file row under the Changes app bar, IDE-style: the tree toggle, then the
 * selected file (viewed mark, path, counts, previous/next, its actions). Submit
 * lives in the app bar and Guide above the tree, away from each other's
 * targets. The guide replaces the file part with the viewed summary.
 */
export function ChangesToolbar({
  file,
  filesOpen,
  host,
  onFiles,
  onRun,
  summary,
  tablet,
  view,
}: {
  readonly file: ToolbarFile | null;
  readonly filesOpen: boolean;
  readonly host: string;
  readonly onFiles: () => void;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly summary: string;
  readonly tablet: boolean;
  readonly view: "files" | "guide";
}): React.JSX.Element {
  const fileControls = view === "files" ? file : null;
  return (
    <View style={styles.bar} testID="changes-toolbar">
      {(tablet || fileControls === null) && (
        <ToolButton
          accessibilityLabel={filesOpen && view === "files" ? "Hide files" : "Show files"}
          icon="albums-outline"
          onPress={onFiles}
          selected={view === "files" && filesOpen}
          testID="changes-view-files"
        />
      )}
      {fileControls !== null ? (
        <FileControls
          file={fileControls}
          host={host}
          onFiles={onFiles}
          onRun={onRun}
          tablet={tablet}
        />
      ) : (
        <Text numberOfLines={1} style={styles.summary}>
          {summary}
        </Text>
      )}
    </View>
  );
}

function FileControls({
  file: selected,
  host,
  onFiles,
  onRun,
  tablet,
}: {
  readonly file: ToolbarFile;
  readonly host: string;
  readonly onFiles: () => void;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly tablet: boolean;
}): React.JSX.Element {
  const { file } = selected;
  const slash = file.path.lastIndexOf("/");
  return (
    <>
      {tablet ? (
        <Text ellipsizeMode="head" numberOfLines={1} style={styles.path}>
          {file.path.slice(slash + 1)}
        </Text>
      ) : (
        <Pressable
          accessibilityLabel={`Choose file, ${file.path}`}
          accessibilityRole="button"
          onPress={onFiles}
          style={styles.picker}
          testID="changes-view-files"
        >
          <Text numberOfLines={1} style={styles.name}>
            {file.path.slice(slash + 1)}
          </Text>
          <Ionicons color={colors.textMuted} name="chevron-down" size={iconSize.inline} />
        </Pressable>
      )}
      <View style={styles.tool} testID="changes-file-viewed">
        <ViewedToggle
          file={file}
          host={host}
          onToggle={selected.toggleViewed}
          pending={selected.viewedPending}
        />
      </View>
      {tablet ? <DiffCounts file={file} /> : null}
      {tablet ? (
        <>
          <ToolButton
            accessibilityLabel="Previous file"
            disabled={selected.previous === null}
            icon="chevron-up"
            onPress={selected.previous}
            selected={false}
            testID="changes-file-previous"
          />
          <ToolButton
            accessibilityLabel="Next file"
            disabled={selected.next === null}
            icon="chevron-down"
            onPress={selected.next}
            selected={false}
            testID="changes-file-next"
          />
        </>
      ) : null}
      <OverflowActionsMenu
        accessibilityLabel={`Actions for ${file.path}`}
        actions={selected.actions}
        compact
        extra={tablet ? [] : fileNavigationActions(selected)}
        onRun={onRun}
      />
    </>
  );
}

function fileNavigationActions(selected: ToolbarFile): ExtraMenuItem[] {
  const actions: ExtraMenuItem[] = [];
  if (selected.previous !== null) {
    actions.push({
      icon: "chevron-up",
      id: "previous-file",
      label: "Previous file",
      onSelect: selected.previous,
    });
  }
  if (selected.next !== null) {
    actions.push({
      icon: "chevron-down",
      id: "next-file",
      label: "Next file",
      onSelect: selected.next,
    });
  }
  return actions;
}

function ToolButton({
  accessibilityLabel,
  disabled = false,
  icon,
  onPress,
  selected,
  testID,
}: {
  readonly accessibilityLabel: string;
  readonly disabled?: boolean;
  readonly icon: React.ComponentProps<typeof Ionicons>["name"];
  readonly onPress: (() => void) | null;
  readonly selected: boolean;
  readonly testID: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled || onPress === null}
      hitSlop={controlHitSlop.compact}
      onPress={onPress}
      style={[styles.tool, selected && styles.toolSelected, disabled && styles.toolDisabled]}
      testID={testID}
    >
      <Ionicons
        color={selected ? colors.text : colors.textMuted}
        name={icon}
        size={iconSize.inline}
      />
    </Pressable>
  );
}

const DISABLED_OPACITY = 0.4;

const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.xxs,
    flexDirection: "row",
    height: controlSize.regular,
    paddingHorizontal: spacing.xxs,
  },
  name: {
    ...typeScale.label,
    color: colors.text,
    flexShrink: 1,
  },
  path: {
    ...typeScale.label,
    color: colors.text,
    flex: 1,
    fontFamily: "monospace",
    minWidth: 0,
  },
  picker: {
    alignItems: "center",
    columnGap: spacing.xs,
    flex: 1,
    flexDirection: "row",
    minHeight: controlSize.regular,
  },
  summary: {
    ...typeScale.label,
    color: colors.textMuted,
    flex: 1,
    paddingHorizontal: spacing.xxs,
  },
  tool: {
    alignItems: "center",
    borderRadius: spacing.xxs,
    height: controlSize.compact,
    justifyContent: "center",
    width: controlSize.compact,
  },
  toolDisabled: {
    opacity: DISABLED_OPACITY,
  },
  toolSelected: {
    backgroundColor: colors.surfaceContainerHigh,
  },
});
