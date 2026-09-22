import { Ionicons } from "@expo/vector-icons";
import { LegendList } from "@legendapp/list/react-native";
import { AppButton as Button } from "../../presentation/controls/AppButton";
import { ActivityIndicator, Pressable, View } from "react-native";
import { joinDirectoryPath } from "../../data/remote-projects";
import { useEvent } from "../../react/useEvent";
import { colors, controlSize, iconSize, spacing } from "../../theme";
import { listRowHeight, listRowPosition } from "../../ui/AppListRow.types";
import { AppSheetScrollView } from "../../ui/AppSheet";
import { useAppDialog } from "../../ui/AppDialog";
import { AppText as Text } from "../../ui/Typography";
import type { ProjectPickerProps } from "./projectPickerContract";
import { EmptyState, PickerRow, ProjectChoiceRow, SectionLabel } from "./ProjectPickerRows";
import type { ProjectPickerSession } from "./projectPickerSession";
import { styles } from "./ProjectPickerSheet.styles";

export function ProjectPickerContent({
  props,
  state,
}: {
  props: ProjectPickerProps;
  state: ProjectPickerSession;
}) {
  const { busy, cwd, onAddProject, onManageProjects, onReadHomeDirectory, onSelect } = props;
  const dialog = useAppDialog();
  const selectProject = useEvent((path: string | null): void => {
    onSelect(path).catch((error: unknown) => {
      dialog.alert(
        "Could not open project",
        error instanceof Error ? error.message : "Could not open project",
      );
    });
  });
  const {
    adding,
    directory,
    directoryLoading,
    directoryPath,
    mode,
    navigate,
    normalizedQuery,
    pinningPath,
    pinProject,
    projectRows,
    readError,
    requestedDirectory,
    toggleProjectSection,
    visibleDirectories,
  } = state;
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
                    disabled={busy}
                    icon="server-outline"
                    onPress={() => {
                      if (!busy) {
                        selectProject(null);
                      }
                    }}
                    selected={false}
                    subtitle="Let Codex choose the working directory"
                    title="Server default"
                  />
                </View>
              );
            }
            const canPin =
              !item.pinned && onAddProject !== undefined && onManageProjects === undefined;
            return (
              <ProjectChoiceRow
                busy={busy || pinningPath !== null}
                cwd={cwd}
                onPin={canPin ? () => void pinProject(item.project) : undefined}
                onSelect={selectProject}
                pinned={item.pinned}
                pinning={pinningPath === item.project.path}
                position={item.position}
                project={item.project}
              />
            );
          }}
          renderScrollComponent={AppSheetScrollView}
          style={styles.projectScroll}
        />
      ) : readError !== null ? (
        <View style={styles.centerState}>
          <Ionicons
            color={colors.textDim}
            name="folder-open-outline"
            size={iconSize.illustration}
          />
          <Text style={styles.stateText}>Could not open this folder</Text>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {readError}
          </Text>
          {onReadHomeDirectory !== undefined && requestedDirectory !== null ? (
            <Button
              onPress={() => {
                navigate(null);
              }}
              variant="secondary"
            >
              Go to Home
            </Button>
          ) : null}
        </View>
      ) : directoryLoading || directory.status !== "ready" ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} size="small" />
          <Text style={styles.stateText}>Opening folder…</Text>
        </View>
      ) : (
        <LegendList
          contentContainerStyle={styles.listContent}
          data={visibleDirectories}
          drawDistance={360}
          getFixedItemSize={() => listRowHeight.single}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(entry) => entry.fileName}
          ListEmptyComponent={
            <EmptyState
              icon="folder-open-outline"
              text={
                normalizedQuery === "" ? "This folder has no subfolders" : "No matching folders"
              }
            />
          }
          recycleItems
          renderItem={({ index, item }) => (
            <PickerRow
              chevron
              disabled={adding}
              icon="folder"
              onPress={() => {
                navigate(joinDirectoryPath(directoryPath, item.fileName));
              }}
              position={listRowPosition(index, visibleDirectories.length)}
              selected={false}
              title={item.fileName}
            />
          )}
          renderScrollComponent={AppSheetScrollView}
          style={styles.projectScroll}
        />
      )}
    </View>
  );
}
