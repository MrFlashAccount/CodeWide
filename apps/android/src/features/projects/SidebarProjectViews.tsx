import { Ionicons } from "@expo/vector-icons";
import { LegendList } from "@legendapp/list/react-native";
import { Pressable, View } from "react-native";
import { useId, type ReactNode } from "react";
import { useEvent } from "../../react/useEvent";
import { colors, iconSize } from "../../theme";
import { AppSheet, AppSheetScrollView } from "../../ui/AppSheet";
import { AppText as Text } from "../../ui/Typography";
import { useConversationOwner } from "../../ui/use-conversation-owner";
import { useProjectManagement, type ProjectManagementState } from "./projectManagement";
import { ProjectServerFilters } from "./ProjectServerFilters";
import type { ProjectManagementProps } from "./projectManagementContract";
import { ProjectManagementRow, projectManagerItemHeight } from "./ProjectManagementRow";
import type { SidebarProject } from "./sidebarProjects";
import { styles } from "./SidebarProjects.styles";

// WHY: React Compiler cannot lower String.raw; this is the Unicode code point for its required backslash.
const BACKSLASH_CODE_POINT = 92;
const ARCHIVE_CRUMB = `${String.fromCodePoint(BACKSLASH_CODE_POINT)} Archive`;

export { SidebarProjectRow } from "./SidebarProjectRow";

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
function ProjectManagementAddAction({
  props,
  state,
}: {
  readonly props: ProjectManagementProps;
  readonly state: ProjectManagementState;
}): React.JSX.Element {
  const { servers } = props;
  const { pending, selectedServer } = state;
  const browseSelected = useEvent(() => {
    props.onBrowse(selectedServer?.id ?? null);
  });
  return (
    <Pressable
      accessibilityLabel="Add project"
      accessibilityRole="button"
      disabled={servers.length === 0 || pending !== null}
      onPress={browseSelected}
      style={({ pressed }) => [
        styles.headerAction,
        pressed && styles.shortcutPressed,
        (servers.length === 0 || pending !== null) && styles.disabled,
      ]}
    >
      <Ionicons color={colors.text} name="add" size={iconSize.action} />
    </Pressable>
  );
}

function ProjectManagementSurface({
  children,
  onClose,
  visible,
}: {
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly visible: boolean;
}): React.JSX.Element {
  const owner = useConversationOwner(useId());
  const changeOpen = useEvent((open: boolean) => {
    if (!open && visible && owner.isCurrent()) {
      onClose();
    }
  });
  return (
    <AppSheet
      contentProps={{
        dismissLabel: "Close project management",
        enableDynamicSizing: false,
        performanceSurface: "projects",
        snapPoints: ["62%", "92%"],
      }}
      isOpen={visible}
      onOpenChange={changeOpen}
    >
      {children}
    </AppSheet>
  );
}

export function SidebarProjectsSheet(
  props: ProjectManagementProps & { readonly visible: boolean },
) {
  const { servers } = props;
  const state = useProjectManagement(props);
  const { dataVersion, pending, rows, selectedServerId, setSelectedServerId } = state;
  return (
    <ProjectManagementSurface
      key={props.visible ? "open" : "closed"}
      onClose={props.onClose}
      visible={props.visible}
    >
      <View style={styles.sheetHeader} testID="project-management-header">
        <Text accessibilityRole="header" style={styles.sheetTitle}>
          Manage Projects
        </Text>
        <ProjectManagementAddAction props={props} state={state} />
      </View>
      {servers.length > 1 ? (
        <ProjectServerFilters
          busy={pending !== null}
          onSelect={setSelectedServerId}
          selected={selectedServerId}
          servers={servers}
        />
      ) : null}
      <LegendList
        contentContainerStyle={styles.sheetListContent}
        data={rows}
        dataVersion={dataVersion}
        drawDistance={320}
        extraData={dataVersion}
        getFixedItemSize={projectManagerItemHeight}
        getItemType={(item) => item.kind}
        key={selectedServerId ?? "all"}
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
    </ProjectManagementSurface>
  );
}
