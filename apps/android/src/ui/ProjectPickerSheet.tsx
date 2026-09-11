import { Ionicons } from "@expo/vector-icons";
import { LegendList } from "@legendapp/list/react-native";
import { Button } from "heroui-native/button";
import { AppListRow } from "./AppListRow";
import { listRowHeight, listRowPosition, type AppListRowProps } from "./AppListRow.types";
import { SearchField } from "heroui-native/search-field";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";

import type { RemoteDirectoryEntry, RemoteProject } from "../data/remote-projects";
import type { ComposeIconName } from "../presentation/icons/composeIconNames";
import {
  directoryCrumbs,
  joinDirectoryPath,
  normalizeDirectoryPath,
  parentDirectoryPath,
  partitionDiscoveredProjects,
  projectIncludesDirectory,
} from "../data/remote-projects";
import { useEvent } from "../react/useEvent";
import { useAsyncResource } from "../rendering/async-resource-store";
import { colors, radii, spacing, typeScale, iconSize, layoutSize, controlSize } from "../theme";
import { AppSheet, AppSheetScrollView } from "./AppSheet";
import { AppText as Text } from "./Typography";

type PickerMode = "projects" | "directory";
type ProjectSectionId = "other" | "recent";
type ProjectListItem =
  | {
      compact: boolean;
      icon: keyof typeof Ionicons.glyphMap;
      id: string;
      kind: "empty";
      text: string;
    }
  | {
      id: string;
      kind: "project";
      pinned: boolean;
      position: AppListRowProps["position"];
      project: RemoteProject;
    }
  | {
      count: number;
      expanded: boolean;
      id: string;
      kind: "section";
      sectionId: ProjectSectionId | null;
      title: string;
    }
  | { id: string; kind: "server-default" };
const RECENT_PROJECT_LIMIT = 8;

export function ProjectPickerSheet({
  visible,
  cwd,
  projects,
  discoveredProjects,
  busy,
  error,
  onSelect,
  onAddProject,
  onReadDirectory,
  onReadHomeDirectory,
  onClose,
  browseOnly = false,
  onManageProjects,
}: {
  visible: boolean;
  cwd: string;
  projects: readonly RemoteProject[];
  discoveredProjects: readonly RemoteProject[];
  busy: boolean;
  error: string | null;
  onSelect(cwd: string | null): Promise<void>;
  onAddProject?(path: string): Promise<RemoteProject>;
  onReadDirectory?(path: string): Promise<RemoteDirectoryEntry[]>;
  onReadHomeDirectory?(): Promise<string>;
  onClose(): void;
  browseOnly?: boolean;
  onManageProjects?(): void;
}) {
  const [mode, setMode] = useState<PickerMode>(browseOnly ? "directory" : "projects");
  const [query, setQuery] = useState("");
  const initialDirectory =
    normalizeDirectoryPath(cwd) || projects[0]?.path || discoveredProjects[0]?.path || "/";
  const [requestedDirectory, setDirectoryPath] = useState<string | null>(
    onReadHomeDirectory === undefined ? initialDirectory : null,
  );
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pinningPath, setPinningPath] = useState<string | null>(null);
  const [projectActionError, setProjectActionError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<ReadonlySet<ProjectSectionId>>(
    () => new Set(["recent"]),
  );
  const wasVisible = useRef(false);
  const pickerId = useId();
  const breadcrumbScroll = useRef<ScrollView>(null);
  const scrollToCurrentFolder = useEvent(() =>
    breadcrumbScroll.current?.scrollToEnd({ animated: false }),
  );
  const readHome = useEvent(async () => {
    if (onReadHomeDirectory === undefined) throw new Error("Server home directory is unavailable");
    return await onReadHomeDirectory();
  });
  const home = useAsyncResource<string>(
    visible && mode === "directory" && onReadHomeDirectory !== undefined
      ? `${pickerId}:home`
      : null,
    0,
    readHome,
  );
  const directoryPath = requestedDirectory ?? home.value ?? "";
  const readDirectory = useEvent(async (path: string) => (await onReadDirectory?.(path)) ?? []);
  const directory = useAsyncResource<RemoteDirectoryEntry[]>(
    visible && mode === "directory" && directoryPath !== "" && onReadDirectory !== undefined
      ? `${pickerId}:${directoryPath}`
      : null,
    0,
    async () => {
      const entries = await readDirectory(directoryPath);
      return entries
        .filter((entry) => entry.isDirectory)
        .sort((left, right) =>
          left.fileName.localeCompare(right.fileName, undefined, {
            numeric: true,
            sensitivity: "base",
          }),
        );
    },
  );
  const directoryEntries = directory.value ?? [];
  const homeError = requestedDirectory === null ? home.error : null;
  const readError = homeError ?? directory.error;
  const directoryLoading =
    directory.status === "loading" || (requestedDirectory === null && home.status === "loading");

  useEffect(() => {
    if (visible && !wasVisible.current) {
      setMode(browseOnly ? "directory" : "projects");
      setQuery("");
      setDirectoryPath(onReadHomeDirectory === undefined ? initialDirectory : null);
      setDirectoryError(null);
      setAdding(false);
      setPinningPath(null);
      setProjectActionError(null);
      setExpandedSections(new Set(["recent"]));
    }
    wasVisible.current = visible;
  }, [browseOnly, initialDirectory, onReadHomeDirectory, visible]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const { recent: recentProjects, other: otherProjects } = useMemo(
    () => partitionDiscoveredProjects(projects, discoveredProjects, RECENT_PROJECT_LIMIT),
    [discoveredProjects, projects],
  );
  const unpinnedProjects = [...recentProjects, ...otherProjects];
  const searchProjects =
    normalizedQuery === ""
      ? []
      : [...projects, ...unpinnedProjects].filter((project) =>
          `${project.name}\n${project.path}`.toLocaleLowerCase().includes(normalizedQuery),
        );
  const visibleDirectories =
    normalizedQuery === ""
      ? directoryEntries
      : directoryEntries.filter((entry) =>
          entry.fileName.toLocaleLowerCase().includes(normalizedQuery),
        );
  const parentPath = parentDirectoryPath(directoryPath);
  const toggleProjectSection = (sectionId: ProjectSectionId) => {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };
  const projectRows: ProjectListItem[] = [];
  if (normalizedQuery !== "") {
    projectRows.push({
      count: searchProjects.length,
      expanded: true,
      id: "section:search",
      kind: "section",
      sectionId: null,
      title: "Search results",
    });
    for (const [index, project] of searchProjects.entries()) {
      projectRows.push({
        id: `project:${project.path}`,
        kind: "project",
        pinned: projects.some((candidate) => projectIncludesDirectory(candidate, project.path)),
        position: listRowPosition(index, searchProjects.length),
        project,
      });
    }
    if (searchProjects.length === 0)
      projectRows.push({
        compact: true,
        icon: "search-outline",
        id: "empty:search",
        kind: "empty",
        text: "No matching projects",
      });
  } else {
    projectRows.push({
      count: projects.length,
      expanded: true,
      id: "section:pinned",
      kind: "section",
      sectionId: null,
      title: "Pinned",
    });
    for (const [index, project] of projects.entries()) {
      projectRows.push({
        id: `project:${project.path}`,
        kind: "project",
        pinned: true,
        position: listRowPosition(index, projects.length),
        project,
      });
    }
    if (projects.length === 0)
      projectRows.push({
        compact: true,
        icon: "pin-outline",
        id: "empty:pinned",
        kind: "empty",
        text: "Add a folder to pin it here",
      });
    if (unpinnedProjects.length > 0) {
      const recentExpanded = expandedSections.has("recent");
      projectRows.push({
        count: recentProjects.length,
        expanded: recentExpanded,
        id: "section:recent",
        kind: "section",
        sectionId: "recent",
        title: "Recent",
      });
      if (recentExpanded) {
        for (const [index, project] of recentProjects.entries()) {
          projectRows.push({
            id: `project:${project.path}`,
            kind: "project",
            pinned: false,
            position: listRowPosition(index, recentProjects.length),
            project,
          });
        }
      }
      if (otherProjects.length > 0) {
        const otherExpanded = expandedSections.has("other");
        projectRows.push({
          count: otherProjects.length,
          expanded: otherExpanded,
          id: "section:other",
          kind: "section",
          sectionId: "other",
          title: "Other",
        });
        if (otherExpanded) {
          for (const [index, project] of otherProjects.entries()) {
            projectRows.push({
              id: `project:${project.path}`,
              kind: "project",
              pinned: false,
              position: listRowPosition(index, otherProjects.length),
              project,
            });
          }
        }
      }
    }
    projectRows.push({ id: "server-default", kind: "server-default" });
  }

  const navigate = (path: string | null) => {
    if (adding) return;
    setQuery("");
    setDirectoryPath(path);
    setDirectoryError(null);
  };
  const openDirectoryPicker = () => {
    if (onReadDirectory === undefined || onAddProject === undefined) return;
    setQuery("");
    setDirectoryError(null);
    setDirectoryPath(onReadHomeDirectory === undefined ? initialDirectory : null);
    setMode("directory");
  };
  const addCurrentDirectory = async () => {
    if (
      onAddProject === undefined ||
      adding ||
      busy ||
      directory.status !== "ready" ||
      directoryPath === ""
    )
      return;
    setAdding(true);
    setDirectoryError(null);
    try {
      const project = await onAddProject(directoryPath);
      await onSelect(project.path);
    } catch (cause) {
      setDirectoryError(cause instanceof Error ? cause.message : "Could not add project");
    }
    setAdding(false);
  };
  const pinProject = async (project: RemoteProject) => {
    if (onAddProject === undefined || pinningPath !== null || busy) return;
    setPinningPath(project.path);
    setProjectActionError(null);
    try {
      await onAddProject(project.path);
    } catch (cause) {
      setProjectActionError(cause instanceof Error ? cause.message : "Could not pin project");
    }
    setPinningPath(null);
  };

  return (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      contentProps={{
        dismissLabel: "Close project picker",
        performanceSurface: mode === "projects" ? "projects" : "folders",
        index: 0,
        snapPoints: ["62%", "92%"],
        enableDynamicSizing: false,
        enableOverDrag: false,
        contentContainerClassName: "h-full",
      }}
    >
      <View style={styles.header}>
        {mode === "directory" ? (
          <Button
            size="sm"
            variant="ghost"
            isIconOnly
            accessibilityLabel="Back to projects"
            onPress={() => {
              if (browseOnly) onClose();
              else {
                setMode("projects");
                setQuery("");
              }
            }}
          >
            <Ionicons name="arrow-back" size={iconSize.action} color={colors.text} />
          </Button>
        ) : null}
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{mode === "projects" ? "Choose project" : "Add project"}</Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {mode === "projects"
              ? `${projects.length} pinned · ${unpinnedProjects.length} from history`
              : "Choose a folder on this server"}
          </Text>
        </View>
        {mode === "projects" && onManageProjects !== undefined ? (
          <Button
            size="sm"
            variant="ghost"
            accessibilityLabel="Manage Projects"
            onPress={onManageProjects}
          >
            Manage Projects
          </Button>
        ) : null}
        {mode === "projects" &&
        onManageProjects === undefined &&
        onReadDirectory !== undefined &&
        onAddProject !== undefined ? (
          <Button
            size="sm"
            variant="secondary"
            isIconOnly
            accessibilityLabel="Add project"
            onPress={openDirectoryPicker}
          >
            <Ionicons name="add" size={iconSize.navigation} color={colors.text} />
          </Button>
        ) : null}
      </View>

      {mode === "directory" ? (
        <View style={styles.pathPanel}>
          <View style={styles.pathActions}>
            {onReadHomeDirectory !== undefined ? (
              <Button
                size="sm"
                variant="ghost"
                isIconOnly
                accessibilityLabel="Home directory"
                isDisabled={adding}
                onPress={() => navigate(null)}
              >
                <Ionicons name="home-outline" size={iconSize.action} color={colors.textMuted} />
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              accessibilityLabel="Parent directory"
              isDisabled={parentPath === null || adding}
              onPress={() => {
                if (parentPath !== null) navigate(parentPath);
              }}
            >
              <Ionicons
                name="arrow-up"
                size={iconSize.action}
                color={parentPath === null ? colors.textDim : colors.text}
              />
            </Button>
            <ScrollView
              ref={breadcrumbScroll}
              onContentSizeChange={scrollToCurrentFolder}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.breadcrumbViewport}
              contentContainerStyle={styles.breadcrumbs}
            >
              {directoryCrumbs(directoryPath, home.value).map((crumb, index, crumbs) => (
                <View key={crumb.path} style={styles.crumbGroup}>
                  {index > 0 ? (
                    <Ionicons
                      name="chevron-forward"
                      size={iconSize.inline}
                      color={colors.textDim}
                    />
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    accessibilityLabel={`Open directory ${crumb.path}`}
                    isDisabled={adding}
                    onPress={() => navigate(crumb.path)}
                    style={styles.crumbButton}
                  >
                    <Text
                      numberOfLines={1}
                      style={[styles.crumbText, index === crumbs.length - 1 && styles.currentCrumb]}
                    >
                      {crumb.label}
                    </Text>
                  </Button>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      ) : null}

      <SearchField value={query} onChange={setQuery} style={styles.searchField}>
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input
            placeholder={mode === "projects" ? "Search projects" : "Filter folders"}
          />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>

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
                  : item.compact ? 92 : 150
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

      {mode === "directory" ? (
        <View style={styles.footer}>
          {directoryError !== null ? (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {directoryError}
            </Text>
          ) : null}
          <Button
            variant="primary"
            isDisabled={
              busy ||
              adding ||
              directoryLoading ||
              readError !== null ||
              directory.status !== "ready"
            }
            onPress={() => void addCurrentDirectory()}
          >
            {adding ? "Adding project…" : browseOnly ? "Add this folder" : "Use this folder"}
          </Button>
        </View>
      ) : (
        <View style={styles.footerStatus}>
          {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
          {busy ? <Text style={styles.stateText}>Switching project…</Text> : null}
          {projectActionError !== null ? (
            <Text style={styles.errorText}>{projectActionError}</Text>
          ) : null}
          {error !== null ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      )}
    </AppSheet>
  );
}

function SectionLabel({ title, count }: { title: string; count: number }) {
  return (
    <View style={styles.sectionLabel}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionCount}>{count}</Text>
    </View>
  );
}

function ProjectChoiceRow({
  project,
  cwd,
  busy,
  pinned = false,
  pinning = false,
  position = "only",
  onPin,
  onSelect,
}: {
  project: RemoteProject;
  cwd: string;
  busy: boolean;
  pinned?: boolean;
  pinning?: boolean;
  position?: AppListRowProps["position"];
  onPin?: (() => void) | undefined;
  onSelect(cwd: string | null): Promise<void>;
}) {
  const selected = projectIncludesDirectory(project, cwd);
  return (
    <PickerRow
      position={position}
      icon={pinned ? "pin" : "folder-outline"}
      title={project.name}
      subtitle={project.path}
      selected={selected}
      disabled={busy}
      action={
        onPin === undefined
          ? undefined
          : {
              label: "Pin",
              accessibilityLabel: `Pin ${project.name}`,
              loading: pinning,
              onPress: onPin,
            }
      }
      onPress={() => {
        if (!busy && !selected) void onSelect(project.path);
      }}
    />
  );
}

function PickerRow({
  icon,
  title,
  subtitle,
  selected,
  disabled,
  chevron = false,
  action,
  position = "only",
  onPress,
}: {
  icon: ComposeIconName;
  title: string;
  subtitle?: string;
  selected: boolean;
  disabled: boolean;
  chevron?: boolean;
  position?: AppListRowProps["position"];
  action?:
    | {
        label: string;
        accessibilityLabel: string;
        loading: boolean;
        onPress(): void;
      }
    | undefined;
  onPress(): void;
}) {
  return (
    <AppListRow
      title={title}
      {...(subtitle === undefined ? {} : { description: subtitle })}
      selected={selected}
      disabled={disabled}
      onPress={onPress}
      position={position}
      fixedHeight={subtitle === undefined ? listRowHeight.single : listRowHeight.double}
      leadingIcon={{ name: icon, size: iconSize.action, color: colors.textMuted }}
      {...(action !== undefined ? {
        trailing: (
          <Button
            size="sm"
            variant="outline"
            accessibilityLabel={action.accessibilityLabel}
            isDisabled={disabled || action.loading}
            style={styles.rowAction}
            onPress={action.onPress}
          >
            {action.loading ? <ActivityIndicator size="small" color={colors.text} /> : action.label}
          </Button>
        ),
      } : chevron ? {
        trailingIcon: { name: "chevron-forward", size: iconSize.inline, color: colors.textDim },
      } : {})}
    />
  );
}

function EmptyState({
  icon,
  text,
  compact = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  compact?: boolean;
}) {
  return (
    <View style={[styles.emptyState, compact && styles.emptyStateCompact]}>
      <Ionicons name={icon} size={iconSize.illustration} color={colors.textDim} />
      <Text style={styles.stateText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: layoutSize.header,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  titleBlock: { flex: 1, minWidth: 0 },
  title: { ...typeScale.heading, color: colors.text },
  subtitle: { ...typeScale.label, color: colors.textMuted },
  pathPanel: {
    marginTop: spacing.xs,
    padding: spacing.xs,
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceRaised,
  },
  pathActions: { flexDirection: "row", alignItems: "center", minWidth: 0 },
  breadcrumbs: { alignItems: "center", paddingRight: spacing.sm },
  crumbGroup: { flexDirection: "row", alignItems: "center" },
  breadcrumbViewport: { flex: 1, minWidth: 0 },
  crumbButton: { maxWidth: 220 },
  crumbText: { ...typeScale.label, color: colors.textMuted, flexShrink: 1 },
  currentCrumb: { color: colors.text },
  searchField: { marginTop: spacing.sm },
  listFrame: { flex: 1, minHeight: 0, marginTop: spacing.sm },
  projectScroll: { flex: 1, minHeight: 0 },
  listContent: { paddingBottom: spacing.sm },
  sectionLabel: {
    height: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  sectionTitle: { ...typeScale.body, color: colors.text },
  sectionCount: { ...typeScale.label, color: colors.textMuted },
  accordionTitle: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  projectSectionToggle: {
    height: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xs,
  },
  rowAction: { minHeight: controlSize.regular, flexShrink: 0, marginRight: spacing.sm },
  centerState: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  emptyState: { height: 150, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  emptyStateCompact: { height: 92 },
  stateText: { ...typeScale.body, color: colors.textMuted },
  footer: { flexShrink: 0, gap: spacing.sm, paddingTop: spacing.sm },
  footerStatus: {
    minHeight: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  errorText: { ...typeScale.body, color: colors.red },
  disabled: { opacity: 0.5 },
});
