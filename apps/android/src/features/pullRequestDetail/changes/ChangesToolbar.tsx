import { Ionicons } from "@expo/vector-icons";
import { setStringAsync } from "expo-clipboard";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { PullRequestFile } from "../../../data/forgeMutationContract";
import { useEvent } from "../../../react/useEvent";
import { colors, controlSize, iconSize, spacing, typeScale, typeWeight } from "../../../theme";
import { useAppDialog } from "../../../ui/AppDialog";
import { AppText as Text } from "../../../ui/Typography";
import { SidebarToggle } from "../../../ui/SidebarToggle";
import { OverflowActionsMenu, type ExtraMenuItem } from "../actions/OverflowActionsMenu";

/** Navigation and actions belonging to the selected file, below the PR navigation bar. */
export function ChangesToolbar({
  actions,
  extra,
  file,
  filesOpen,
  onFiles,
  onRun,
  scrollPath,
  tablet,
}: {
  readonly actions: readonly ActionDescriptor[];
  readonly extra: readonly ExtraMenuItem[];
  readonly file: PullRequestFile | null;
  readonly filesOpen: boolean;
  readonly onFiles: () => void;
  readonly onRun: (action: ActionDescriptor) => void;
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
  const text = <FileName path={name} scroll={scrollPath} />;
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
function FileName({
  path,
  scroll,
}: {
  readonly path: string;
  readonly scroll: boolean;
}): React.JSX.Element {
  const text = (
    <Text numberOfLines={1} style={styles.name}>
      {scroll ? path : path.split("/").at(-1)}
    </Text>
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
});
