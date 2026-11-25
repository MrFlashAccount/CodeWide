import { Ionicons } from "@expo/vector-icons";
import { setStringAsync } from "expo-clipboard";
import { useRef } from "react";
import type { Text as NativeText } from "react-native";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { PullRequestFile } from "../../../data/forgeMutationContract";
import { useEvent } from "../../../react/useEvent";
import {
  colors,
  controlSize,
  disabledOpacity,
  iconSize,
  spacing,
  typeScale,
  typeWeight,
} from "../../../theme";
import { useAppDialog } from "../../../ui/AppDialog";
import { TextShimmer } from "../../../ui/TextShimmer";
import type { FileExpansion } from "./useFileExpansion";
import { AppText as Text } from "../../../ui/Typography";
import { SidebarToggle } from "../../../ui/SidebarToggle";
import { OverflowActionsMenu, type ExtraMenuItem } from "../actions/OverflowActionsMenu";

/** Navigation and actions belonging to the selected file, below the PR navigation bar. */
export function ChangesToolbar({
  actions,
  expansion,
  extra,
  file,
  filesOpen,
  onFiles,
  onRun,
  onToggleExpansion,
  scrollPath,
  tablet,
}: {
  readonly actions: readonly ActionDescriptor[];
  readonly expansion: FileExpansion["state"];
  readonly extra: readonly ExtraMenuItem[];
  readonly file: PullRequestFile | null;
  readonly filesOpen: boolean;
  readonly onFiles: () => void;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly onToggleExpansion: () => void;
  readonly scrollPath: boolean;
  readonly tablet: boolean;
}): React.JSX.Element {
  const dialog = useAppDialog();
  const copy = useEvent(() => {
    if (file !== null) {
      void setStringAsync(file.path).catch((error: unknown) => {
        dialog.error("Could not copy the file path", error);
      });
    }
  });
  const name = file?.path ?? "Files";
  const text = <FileName path={name} pending={expansion === "loading"} scroll={scrollPath} />;
  return (
    <View style={styles.bar} testID="changes-toolbar">
      {tablet ? (
        <>
          <SidebarToggle onToggle={onFiles} open={filesOpen} testID="changes-view-files" />
          <View style={styles.title}>{text}</View>
        </>
      ) : (
        <Pressable
          accessibilityLabel={`Choose file, ${file?.path ?? name}`}
          accessibilityRole="button"
          accessibilityState={{ expanded: filesOpen }}
          onPress={onFiles}
          style={styles.picker}
          testID="changes-view-files"
        >
          {text}
          <Ionicons color={colors.textMuted} name="chevron-down" size={iconSize.inline} />
        </Pressable>
      )}
      {expansion !== "hidden" && <ExpansionButton onPress={onToggleExpansion} state={expansion} />}
      {file !== null && (
        <OverflowActionsMenu
          accessibilityLabel={`Actions for ${file.path}`}
          actions={actions}
          extra={[
            { icon: "copy-outline", id: "copyPath", label: "Copy file path", onSelect: copy },
            ...extra,
          ]}
          onRun={onRun}
        />
      )}
    </View>
  );
}
const FILE_TOGGLE_LABELS = {
  compact: "Expand file",
  expanded: "Collapse file",
  failed: "Retry expanding file",
  loading: "Cancel expanding file",
  unavailable: "Full file unavailable",
} as const;

function ExpansionButton({
  onPress,
  state,
}: {
  readonly onPress: () => void;
  readonly state: keyof typeof FILE_TOGGLE_LABELS;
}): React.JSX.Element {
  const disabled = state === "unavailable";
  const expanded = state === "expanded";
  return (
    <Pressable
      accessibilityLabel={FILE_TOGGLE_LABELS[state]}
      accessibilityRole="button"
      accessibilityState={{ busy: state === "loading", disabled, expanded }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.toggle, disabled && styles.disabled]}
    >
      <Svg
        accessible={false}
        fill="none"
        height={iconSize.inline}
        stroke={colors.textMuted}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.65}
        viewBox="0 0 24 24"
        width={iconSize.inline}
      >
        <Path d="M2 12h20" strokeDasharray="2 4" />
        <Path d="M12 2v6m0 8v6" />
        <Path d={expanded ? "M9 5l3 3 3-3M9 19l3-3 3 3" : "M9 5l3-3 3 3M9 19l3 3 3-3"} />
      </Svg>
    </Pressable>
  );
}

function FileName({
  path,
  pending,
  scroll,
}: {
  readonly path: string;
  readonly pending: boolean;
  readonly scroll: boolean;
}): React.JSX.Element {
  const ref = useRef<NativeText>(null);
  const text = (
    <>
      <Text numberOfLines={1} ref={ref} style={styles.name}>
        {scroll ? path : path.split("/").at(-1)}
      </Text>
      <TextShimmer shimmering={pending} target={ref} />
    </>
  );
  return scroll ? (
    <ScrollView
      contentContainerStyle={styles.center}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.path}
    >
      {text}
    </ScrollView>
  ) : (
    text
  );
}
const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.xxs,
  },
  center: { alignItems: "center" },
  disabled: { opacity: disabledOpacity },
  name: {
    ...typeScale.body,
    color: colors.text,
    flexShrink: 1,
    fontWeight: typeWeight.semibold,
  },
  path: {
    flexGrow: 0,
    flexShrink: 1,
  },
  picker: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.xxs,
    minHeight: controlSize.touch,
    minWidth: 0,
    paddingLeft: spacing.sm,
  },
  title: {
    flex: 1,
    minWidth: 0,
  },
  toggle: {
    alignItems: "center",
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
});
