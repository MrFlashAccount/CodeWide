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

export function SidebarProjectRow({
  project,
  onPress,
}: {
  project: SidebarProject;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open project ${project.name}${project.serverLabel === null ? "" : `, ${project.serverLabel}`}${project.unread ? ", unread chats" : ""}`}
      accessibilityHint={project.path}
      onPress={onPress}
      style={({ pressed }) => [styles.project, styles.shortcut, pressed && styles.shortcutPressed]}
    >
      <InlineIcon name="folder-outline" role="body" color={colors.textMuted} />
      <View style={styles.shortcutIdentity}>
        <Text numberOfLines={1} style={styles.name}>
          {project.name}
        </Text>
        {project.serverLabel !== null && (
          <Text numberOfLines={1} style={styles.serverLabel}>{` · ${project.serverLabel}`}</Text>
        )}
      </View>
      <View style={styles.unreadSlot}>
        {project.unread && <View testID={`project-unread:${project.key}`} style={styles.unread} />}
      </View>
    </Pressable>
  );
}
export function SidebarProjectHeader({
  project,
  serverName,
  archived,
  onBack,
  onRoot,
}: {
  project: SidebarProject;
  serverName: string;
  archived: boolean;
  onBack(): void;
  onRoot(): void;
}) {
  return (
    <View testID="sidebar-project-breadcrumbs" style={styles.breadcrumbs}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={archived ? "Back to project chats" : "Back to projects"}
        style={styles.back}
        onPress={onBack}
      >
        <Ionicons name="arrow-back" size={iconSize.inline} color={colors.text} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Back to ${serverName} projects`}
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
          {"\\ Archive"}
        </Text>
      )}
    </View>
  );
}
export function SidebarProjectsSheet(props: ProjectManagementProps) {
  const { servers, onBrowse, onClose } = props;
  const state = useProjectManagement(props);
  const { pending, choosingServer, setChoosingServer, rows } = state;

  return (
    <AppSheet
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      contentProps={{
        dismissLabel: "Close project management",
        performanceSurface: "projects",
        snapPoints: ["62%", "92%"],
        enableDynamicSizing: false,
      }}
    >
      <View testID="project-management-header" style={styles.sheetHeader}>
        <Text accessibilityRole="header" style={styles.sheetTitle}>
          Manage Projects
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add project"
          disabled={servers.length === 0 || pending !== null}
          style={({ pressed }) => [
            styles.headerAction,
            pressed && styles.shortcutPressed,
            (servers.length === 0 || pending !== null) && styles.disabled,
          ]}
          onPress={() => {
            const only = servers[0];
            if (servers.length === 1 && only !== undefined) onBrowse(only.id);
            else setChoosingServer(!choosingServer);
          }}
        >
          <Ionicons name="add" size={20} color={colors.text} />
        </Pressable>
      </View>
      <LegendList
        testID="project-management-list"
        style={styles.sheetList}
        contentContainerStyle={styles.sheetListContent}
        data={rows}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.kind}
        getFixedItemSize={projectManagerItemHeight}
        renderScrollComponent={AppSheetScrollView}
        drawDistance={320}
        recycleItems
        keyboardShouldPersistTaps="handled"
        renderItem={({ item, index }) => (
          <ProjectManagementRow props={props} state={state} item={item} index={index} />
        )}
      />
    </AppSheet>
  );
}
