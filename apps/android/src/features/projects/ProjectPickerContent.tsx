import { Ionicons } from "@expo/vector-icons";
import { LegendList } from "@legendapp/list/react-native";
import { Button } from "heroui-native/button";
import { ActivityIndicator, Pressable, View } from "react-native";
import { joinDirectoryPath } from "../../data/remote-projects";
import { colors, controlSize, iconSize } from "../../theme";
import { listRowHeight, listRowPosition } from "../../ui/AppListRow.types";
import { AppSheetScrollView } from "../../ui/AppSheet";
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
  const { cwd, busy, onSelect, onAddProject, onReadHomeDirectory, onManageProjects } = props;
  const {
    mode,
    requestedDirectory,
    adding,
    pinningPath,
    directoryPath,
    directory,
    readError,
    directoryLoading,
    normalizedQuery,
    visibleDirectories,
    toggleProjectSection,
    projectRows,
    navigate,
    pinProject,
  } = state;
  return (
    <View style={styles.listFrame}>
      {mode === "projects" ? (
        <LegendList
          style={styles.projectScroll}
          data={projectRows}
          drawDistance={360}
          recycleItems
          renderScrollComponent={AppSheetScrollView}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          keyExtractor={(item) => item.id}
          getFixedItemSize={(item) =>
            item.kind === "project" || item.kind === "server-default"
              ? listRowHeight.double
              : item.kind === "section"
                ? controlSize.regular
                : item.compact
                  ? 92
                  : 150
          }
          renderItem={({ item }) => {
            if (item.kind === "section") {
              return item.sectionId === null ? (
                <SectionLabel title={item.title} count={item.count} />
              ) : (
                <Pressable
                  accessibilityLabel={`${item.title} projects, ${item.count}`}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: item.expanded }}
                  onPress={() => {
                    if (item.sectionId !== null) toggleProjectSection(item.sectionId);
                  }}
                  style={styles.projectSectionToggle}
                >
                  <View style={styles.accordionTitle}>
                    <Text style={styles.sectionTitle}>{item.title}</Text>
                    <Text style={styles.sectionCount}>{item.count}</Text>
                  </View>
                  <Ionicons
                    name={item.expanded ? "chevron-up" : "chevron-down"}
                    size={iconSize.inline}
                    color={colors.textMuted}
                  />
                </Pressable>
              );
            }
            if (item.kind === "empty")
              return <EmptyState icon={item.icon} text={item.text} compact={item.compact} />;
            if (item.kind === "server-default") {
              return (
                <PickerRow
                  icon="server-outline"
                  title="Server default"
                  subtitle="Let Codex choose the working directory"
                  selected={false}
                  disabled={busy}
                  onPress={() => {
                    if (!busy) void onSelect(null);
                  }}
                />
              );
            }
            const canPin =
              !item.pinned && onAddProject !== undefined && onManageProjects === undefined;
            return (
              <ProjectChoiceRow
                position={item.position}
                project={item.project}
                cwd={cwd}
                busy={busy || pinningPath !== null}
                pinned={item.pinned}
                pinning={pinningPath === item.project.path}
                onPin={canPin ? () => void pinProject(item.project) : undefined}
                onSelect={onSelect}
              />
            );
          }}
        />
      ) : readError !== null ? (
        <View style={styles.centerState}>
          <Ionicons
            name="folder-open-outline"
            size={iconSize.illustration}
            color={colors.textDim}
          />
          <Text style={styles.stateText}>Could not open this folder</Text>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {readError}
          </Text>
          {onReadHomeDirectory !== undefined && requestedDirectory !== null ? (
            <Button variant="secondary" onPress={() => navigate(null)}>
              Go to Home
            </Button>
          ) : null}
        </View>
      ) : directoryLoading || directory.status !== "ready" ? (
        <View style={styles.centerState}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.stateText}>Opening folder…</Text>
        </View>
      ) : (
        <LegendList
          data={visibleDirectories}
          recycleItems
          getFixedItemSize={() => listRowHeight.single}
          renderScrollComponent={AppSheetScrollView}
          style={styles.projectScroll}
          drawDistance={360}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          keyExtractor={(entry) => entry.fileName}
          renderItem={({ item, index }) => (
            <PickerRow
              position={listRowPosition(index, visibleDirectories.length)}
              icon="folder"
              title={item.fileName}
              selected={false}
              disabled={adding}
              chevron
              onPress={() => navigate(joinDirectoryPath(directoryPath, item.fileName))}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="folder-open-outline"
              text={
                normalizedQuery === "" ? "This folder has no subfolders" : "No matching folders"
              }
            />
          }
        />
      )}
    </View>
  );
}
