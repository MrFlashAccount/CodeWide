import { Ionicons } from "@expo/vector-icons";
import { LegendList } from "@legendapp/list/react-native";
import { Pressable, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppSheet, AppSheetScrollView } from "../../ui/AppSheet";
import { InlineIcon } from "../../ui/InlineIcon";
import { AppText as Text } from "../../ui/Typography";
import { useProjectManagement } from "./projectManagement";
import type { ProjectManagementProps } from "./projectManagementContract";
import { ProjectManagementRow, projectManagerItemHeight } from "./ProjectManagementRow";
import type { SidebarProject } from "./sidebarProjects";
import { styles } from "./SidebarProjects.styles";

// WHY: React Compiler cannot lower String.raw; this is the Unicode code point for its required backslash.
const BACKSLASH_CODE_POINT = 92;
const ARCHIVE_CRUMB = `${String.fromCodePoint(BACKSLASH_CODE_POINT)} Archive`;

export function SidebarProjectRow({
  onPress,
  project,
}: {
  onPress: () => void;
  project: SidebarProject;
}) {
  return (
    <Pressable
      accessibilityHint={project.path}
      accessibilityLabel={`Open project ${project.name}${project.serverLabel === null ? "" : `, ${project.serverLabel}`}${project.unread ? ", unread chats" : ""}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.project, styles.shortcut, pressed && styles.shortcutPressed]}
    >
      <InlineIcon color={colors.textMuted} name="folder-outline" role="body" />
      <View style={styles.shortcutIdentity}>
        <Text numberOfLines={1} style={styles.name}>
          {project.name}
        </Text>
        {project.serverLabel !== null && (
          <Text numberOfLines={1} style={styles.serverLabel}>{` · ${project.serverLabel}`}</Text>
        )}
      </View>
      <View style={styles.unreadSlot}>
        {project.unread && <View style={styles.unread} testID={`project-unread:${project.key}`} />}
      </View>
    </Pressable>
  );
}
export function SidebarProjectHeader({
  archived,
  onBack,
  onRoot,
  project,
  serverName,
}: {
  archived: boolean;
  onBack: () => void;
  onRoot: () => void;
  project: SidebarProject;
  serverName: string;
}) {
  return (
    <View style={styles.breadcrumbs} testID="sidebar-project-breadcrumbs">
      <Pressable
        accessibilityLabel={archived ? "Back to project chats" : "Back to projects"}
        accessibilityRole="button"
        onPress={onBack}
        style={styles.back}
      >
        <Ionicons color={colors.text} name="arrow-back" size={iconSize.inline} />
      </Pressable>
      <Pressable
        accessibilityLabel={`Back to ${serverName} projects`}
        accessibilityRole="button"
        onPress={onRoot}
        style={styles.serverCrumb}
      >
        <Text numberOfLines={1} style={styles.crumbText}>
          {serverName}
        </Text>
      </Pressable>
      <Text style={styles.crumbSeparator}>{"\\"}</Text>
      <Text
        accessibilityLabel={`Project ${project.name}`}
        numberOfLines={1}
        style={[styles.crumbText, styles.projectCrumb]}
      >
        {project.name}
      </Text>
      {archived && (
        <Text numberOfLines={1} style={styles.archiveCrumb}>
          {ARCHIVE_CRUMB}
        </Text>
      )}
    </View>
  );
}
export function SidebarProjectsSheet(
  props: ProjectManagementProps & { readonly visible: boolean },
) {
  const { onBrowse, onClose, servers } = props;
  const state = useProjectManagement(props);
  const { choosingServer, dataVersion, pending, rows, setChoosingServer } = state;

  return (
    <AppSheet
      contentProps={{
        dismissLabel: "Close project management",
        enableDynamicSizing: false,
        performanceSurface: "projects",
        snapPoints: ["62%", "92%"],
      }}
      isOpen={props.visible}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <View style={styles.sheetHeader} testID="project-management-header">
        <Text accessibilityRole="header" style={styles.sheetTitle}>
          Manage Projects
        </Text>
        <Pressable
          accessibilityLabel="Add project"
          accessibilityRole="button"
          disabled={servers.length === 0 || pending !== null}
          onPress={() => {
            const only = servers[0];
            if (servers.length === 1 && only !== undefined) {
              onBrowse(only.id);
            } else {
              setChoosingServer(!choosingServer);
            }
          }}
          style={({ pressed }) => [
            styles.headerAction,
            pressed && styles.shortcutPressed,
            (servers.length === 0 || pending !== null) && styles.disabled,
          ]}
        >
          <Ionicons color={colors.text} name="add" size={20} />
        </Pressable>
      </View>
      <LegendList
        contentContainerStyle={styles.sheetListContent}
        data={rows}
        dataVersion={dataVersion}
        drawDistance={320}
        getFixedItemSize={projectManagerItemHeight}
        getItemType={(item) => item.kind}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => item.key}
        recycleItems
        renderItem={({ index, item }) => (
          <ProjectManagementRow index={index} item={item} props={props} state={state} />
        )}
        renderScrollComponent={AppSheetScrollView}
        style={styles.sheetList}
        testID="project-management-list"
      />
    </AppSheet>
  );
}
