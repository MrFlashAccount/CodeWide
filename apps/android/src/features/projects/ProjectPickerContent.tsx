import { Ionicons } from "@expo/vector-icons";
import { LegendList } from "@legendapp/list/react-native";
import { Pressable, View } from "react-native";
import { useEvent } from "../../react/useEvent";
import { colors, controlSize, iconSize, spacing } from "../../theme";
import { listRowHeight } from "../../ui/AppListRow.types";
import { AppSheetScrollView } from "../../ui/AppSheet";
import { useAppDialog } from "../../ui/AppDialog";
import { AppText as Text } from "../../ui/Typography";
import type { ScopedProjectPickerProps, ProjectDestination } from "./projectPickerContract";
import { EmptyState, PickerRow, ProjectChoiceRow, SectionLabel } from "./ProjectPickerRowViews";
import type { ProjectPickerSession } from "./projectPickerSession";
import { ProjectServerContent } from "./ProjectServerContent";
import { ProjectDirectoryContent } from "./ProjectDirectoryContent";
import { styles } from "./ProjectPickerSheet.styles";

/** Virtualized project and directory lists preserve qualified selection and local errors. */
export function ProjectPickerContent({
  props,
  state,
}: {
  props: ScopedProjectPickerProps;
  state: ProjectPickerSession;
}) {
  const { busy, current, onAddProject, onManageProjects, onSelect } = props;
  const dialog = useAppDialog();
  const selectProject = useEvent((destination: ProjectDestination): void => {
    onSelect(destination).catch((error: unknown) => {
      if (!state.isCurrent()) {
        return;
      }
      dialog.alert(
        "Could not open project",
        error instanceof Error ? error.message : "Could not open project",
      );
    });
  });
  const { mode, pinningPath, pinProject, projectRows, toggleProjectSection } = state;
  return (
    <View style={styles.listFrame}>
      {mode === "projects" ? (
        <LegendList
          contentContainerStyle={styles.listContent}
          data={projectRows}
          drawDistance={360}
          getFixedItemSize={(item) =>
            item.kind === "server-default"
              ? listRowHeight.double + spacing.md
              : item.kind === "project"
                ? listRowHeight.double
                : item.kind === "section"
                  ? controlSize.regular
                  : item.compact
                    ? 92
                    : 150
          }
          key={state.serverFilter ?? "all"}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item) => item.id}
          recycleItems
          renderItem={({ item }) => {
            if (item.kind === "section") {
              return item.sectionId === null ? (
                <SectionLabel count={item.count} title={item.title} />
              ) : (
                <Pressable
                  accessibilityLabel={`${item.title} projects, ${String(item.count)}`}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: item.expanded }}
                  onPress={() => {
                    if (item.sectionId !== null) {
                      toggleProjectSection(item.sectionId);
                    }
                  }}
                  style={styles.projectSectionToggle}
                >
                  <View style={styles.accordionTitle}>
                    <Text style={styles.sectionTitle}>{item.title}</Text>
                    <Text style={styles.sectionCount}>{item.count}</Text>
                  </View>
                  <Ionicons
                    color={colors.textMuted}
                    name={item.expanded ? "chevron-up" : "chevron-down"}
                    size={iconSize.inline}
                  />
                </Pressable>
              );
            }
            if (item.kind === "empty") {
              return <EmptyState compact={item.compact} icon={item.icon} text={item.text} />;
            }
            if (item.kind === "server-default") {
              return (
                <View style={styles.serverDefault}>
                  <PickerRow
                    disabled={busy || !item.available}
                    icon="server-outline"
                    onPress={() => {
                      if (!busy) {
                        selectProject({ connectionId: item.connectionId, cwd: null });
                      }
                    }}
                    selected={false}
                    serverIconId={item.iconId}
                    subtitle={`${item.serverName}${item.available ? "" : " · Offline"} · Let the agent choose the working directory`}
                    title={
                      state.serverFilter === null && props.servers.length > 1
                        ? `${item.serverName} defaults`
                        : "Server default"
                    }
                  />
                </View>
              );
            }
            const canPin =
              !item.pinned && onAddProject !== undefined && onManageProjects === undefined;
            return (
              <ProjectChoiceRow
                busy={busy || pinningPath !== null}
                choice={item.choice}
                current={current}
                onPin={canPin ? () => void pinProject(item.choice) : undefined}
                onSelect={selectProject}
                pinned={item.pinned}
                pinning={pinningPath === item.id}
                position={item.position}
              />
            );
          }}
          renderScrollComponent={AppSheetScrollView}
          style={styles.projectScroll}
        />
      ) : mode === "servers" ? (
        <ProjectServerContent props={props} state={state} />
      ) : (
        <ProjectDirectoryContent props={props} state={state} />
      )}
    </View>
  );
}
