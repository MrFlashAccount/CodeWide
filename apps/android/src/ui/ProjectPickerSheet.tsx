import { Ionicons } from "@expo/vector-icons";
import { LegendList } from "@legendapp/list/react-native";
import { Accordion } from "heroui-native/accordion";
import { Button } from "heroui-native/button";
import { ListGroup } from "heroui-native/list-group";
import { SearchField } from "heroui-native/search-field";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";

import type { RemoteDirectoryEntry, RemoteProject } from "../data/remote-projects";
import { joinDirectoryPath, normalizeDirectoryPath, parentDirectoryPath, partitionDiscoveredProjects, pathCrumbs, projectIncludesDirectory } from "../data/remote-projects";
import { colors, radii, spacing, typeScale } from "../theme";
import { AppSheet, AppSheetScrollView } from "./AppSheet";
import { AppText as Text } from "./Typography";

type PickerMode = "projects" | "directory";
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
  onClose,
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
  onClose(): void;
}) {
  const [mode, setMode] = useState<PickerMode>("projects");
  const [query, setQuery] = useState("");
  const initialDirectory = normalizeDirectoryPath(cwd) || projects[0]?.path || discoveredProjects[0]?.path || "/";
  const [directoryPath, setDirectoryPath] = useState(initialDirectory);
  const [directoryEntries, setDirectoryEntries] = useState<RemoteDirectoryEntry[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pinningPath, setPinningPath] = useState<string | null>(null);
  const [projectActionError, setProjectActionError] = useState<string | null>(null);
  const wasVisible = useRef(false);
  const requestGeneration = useRef(0);
  const directoryCache = useRef(new Map<string, RemoteDirectoryEntry[]>());
  const readDirectory = useEffectEvent(async (path: string) => await onReadDirectory?.(path) ?? []);

  useEffect(() => {
    if (visible && !wasVisible.current) {
      setMode("projects");
      setQuery("");
      setDirectoryPath(normalizeDirectoryPath(cwd) || projects[0]?.path || discoveredProjects[0]?.path || "/");
      setDirectoryError(null);
      setAdding(false);
      setPinningPath(null);
      setProjectActionError(null);
    }
    wasVisible.current = visible;
  }, [cwd, discoveredProjects, projects, visible]);

  useEffect(() => {
    if (!visible || mode !== "directory" || onReadDirectory === undefined) return;
    const generation = ++requestGeneration.current;
    const cached = directoryCache.current.get(directoryPath);
    if (cached !== undefined) {
      setDirectoryEntries(cached);
      setDirectoryLoading(false);
      setDirectoryError(null);
      return;
    }
    setDirectoryEntries([]);
    setDirectoryLoading(true);
    setDirectoryError(null);
    void readDirectory(directoryPath).then(
      (entries) => {
        if (generation !== requestGeneration.current) return;
        const directories = entries
          .filter((entry) => entry.isDirectory)
          .sort((left, right) => left.fileName.localeCompare(right.fileName, undefined, { numeric: true, sensitivity: "base" }));
        directoryCache.current.set(directoryPath, directories);
        setDirectoryEntries(directories);
        setDirectoryLoading(false);
      },
      (cause: unknown) => {
        if (generation !== requestGeneration.current) return;
        setDirectoryLoading(false);
        setDirectoryError(cause instanceof Error ? cause.message : "Could not open directory");
      },
    );
  }, [directoryPath, mode, onReadDirectory, visible]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const { recent: recentProjects, other: otherProjects } = useMemo(
    () => partitionDiscoveredProjects(projects, discoveredProjects, RECENT_PROJECT_LIMIT),
    [discoveredProjects, projects],
  );
  const unpinnedProjects = [...recentProjects, ...otherProjects];
  const searchProjects = normalizedQuery === ""
    ? []
    : [...projects, ...unpinnedProjects].filter((project) => `${project.name}\n${project.path}\n${project.aliases?.join("\n") ?? ""}`.toLocaleLowerCase().includes(normalizedQuery));
  const visibleDirectories = normalizedQuery === ""
    ? directoryEntries
    : directoryEntries.filter((entry) => entry.fileName.toLocaleLowerCase().includes(normalizedQuery));
  const parentPath = parentDirectoryPath(directoryPath);

  const navigate = (path: string) => {
    if (directoryLoading) return;
    setQuery("");
    setDirectoryPath(path);
  };
  const openDirectoryPicker = () => {
    if (onReadDirectory === undefined || onAddProject === undefined) return;
    setQuery("");
    setDirectoryError(null);
    setMode("directory");
  };
  const addCurrentDirectory = async () => {
    if (onAddProject === undefined || adding || busy || directoryLoading) return;
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
      onOpenChange={(open) => { if (!open) onClose(); }}
      contentProps={{ index: 0, snapPoints: ["62%", "92%"], enableDynamicSizing: false, enableOverDrag: false, contentContainerClassName: "h-full" }}
    >
      <View style={styles.header}>
        {mode === "directory" ? (
          <Button size="sm" variant="ghost" isIconOnly accessibilityLabel="Back to projects" onPress={() => { setMode("projects"); setQuery(""); }}>
            <Ionicons name="arrow-back" size={21} color={colors.text} />
          </Button>
        ) : null}
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{mode === "projects" ? "Choose project" : "Add project"}</Text>
          <Text numberOfLines={1} style={styles.subtitle}>{mode === "projects" ? `${projects.length} pinned · ${unpinnedProjects.length} from history` : "Choose a folder on this server"}</Text>
        </View>
        {mode === "projects" && onReadDirectory !== undefined && onAddProject !== undefined ? (
          <Button size="sm" variant="secondary" isIconOnly accessibilityLabel="Add project" onPress={openDirectoryPicker}>
            <Ionicons name="add" size={23} color={colors.text} />
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" isIconOnly accessibilityLabel="Close project picker" onPress={onClose}>
          <Ionicons name="close" size={21} color={colors.text} />
        </Button>
      </View>

      {mode === "directory" ? (
        <View style={styles.pathPanel}>
          <View style={styles.pathActions}>
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              accessibilityLabel="Parent directory"
              isDisabled={parentPath === null || directoryLoading}
              onPress={() => { if (parentPath !== null) navigate(parentPath); }}
            >
              <Ionicons name="arrow-up" size={19} color={parentPath === null ? colors.textDim : colors.text} />
            </Button>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.breadcrumbs}>
              {pathCrumbs(directoryPath).map((crumb, index, crumbs) => (
                <View key={crumb.path} style={styles.crumbGroup}>
                  {index > 0 ? <Ionicons name="chevron-forward" size={14} color={colors.textDim} /> : null}
                  <Button size="sm" variant={index === crumbs.length - 1 ? "secondary" : "ghost"} onPress={() => navigate(crumb.path)}>
                    {crumb.label}
                  </Button>
                </View>
              ))}
            </ScrollView>
          </View>
          <Text selectable numberOfLines={1} style={styles.rawPath}>{directoryPath}</Text>
        </View>
      ) : null}

      <SearchField value={query} onChange={setQuery} style={styles.searchField}>
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder={mode === "projects" ? "Search projects" : "Filter folders"} />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>

      <View style={styles.listFrame}>
        {mode === "projects" ? (
          <AppSheetScrollView style={styles.projectScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.listContent}>
            {normalizedQuery !== "" ? (
              <>
                <SectionLabel title="Search results" count={searchProjects.length} />
                {searchProjects.map((project) => {
                  const pinned = projects.some((candidate) => projectIncludesDirectory(candidate, project.path));
                  return (
                    <ProjectChoiceRow
                      key={project.path}
                      project={project}
                      cwd={cwd}
                      busy={busy || pinningPath !== null}
                      pinned={pinned}
                      pinning={pinningPath === project.path}
                      onPin={pinned || onAddProject === undefined ? undefined : () => void pinProject(project)}
                      onSelect={onSelect}
                    />
                  );
                })}
                {searchProjects.length === 0 ? <EmptyState icon="search-outline" text="No matching projects" compact /> : null}
              </>
            ) : (
              <>
                <SectionLabel title="Pinned" count={projects.length} />
                {projects.map((project) => (
                  <ProjectChoiceRow key={project.path} project={project} cwd={cwd} busy={busy} pinned onSelect={onSelect} />
                ))}
                {projects.length === 0 ? <EmptyState icon="pin-outline" text="Add a folder to pin it here" compact /> : null}

                {unpinnedProjects.length > 0 ? (
                  <Accordion selectionMode="multiple" defaultValue={["recent"]} variant="surface" hideSeparator style={styles.projectAccordion}>
                    <Accordion.Item value="recent">
                      <Accordion.Trigger accessibilityLabel={`Recent projects, ${recentProjects.length}`}>
                        <View style={styles.accordionTitle}>
                          <Text style={styles.sectionTitle}>Recent</Text>
                          <Text style={styles.sectionCount}>{recentProjects.length}</Text>
                        </View>
                        <Accordion.Indicator />
                      </Accordion.Trigger>
                      <Accordion.Content>
                        <View style={styles.accordionContent}>
                          {recentProjects.map((project) => (
                            <ProjectChoiceRow
                              key={project.path}
                              project={project}
                              cwd={cwd}
                              busy={busy || pinningPath !== null}
                              pinning={pinningPath === project.path}
                              onPin={onAddProject === undefined ? undefined : () => void pinProject(project)}
                              onSelect={onSelect}
                            />
                          ))}
                        </View>
                      </Accordion.Content>
                    </Accordion.Item>
                    {otherProjects.length > 0 ? (
                      <Accordion.Item value="other">
                        <Accordion.Trigger accessibilityLabel={`Other projects, ${otherProjects.length}`}>
                          <View style={styles.accordionTitle}>
                            <Text style={styles.sectionTitle}>Other</Text>
                            <Text style={styles.sectionCount}>{otherProjects.length}</Text>
                          </View>
                          <Accordion.Indicator />
                        </Accordion.Trigger>
                        <Accordion.Content>
                          <View style={styles.accordionContent}>
                            {otherProjects.map((project) => (
                              <ProjectChoiceRow
                                key={project.path}
                                project={project}
                                cwd={cwd}
                                busy={busy || pinningPath !== null}
                                pinning={pinningPath === project.path}
                                onPin={onAddProject === undefined ? undefined : () => void pinProject(project)}
                                onSelect={onSelect}
                              />
                            ))}
                          </View>
                        </Accordion.Content>
                      </Accordion.Item>
                    ) : null}
                  </Accordion>
                ) : null}

                <View style={styles.serverDefaultRow}>
                  <PickerRow
                    icon="server-outline"
                    title="Server default"
                    subtitle="Let Codex choose the working directory"
                    selected={false}
                    disabled={busy}
                    onPress={() => { if (!busy) void onSelect(null); }}
                  />
                </View>
              </>
            )}
          </AppSheetScrollView>
        ) : directoryLoading ? (
          <View style={styles.centerState}><ActivityIndicator size="small" color={colors.accent} /><Text style={styles.stateText}>Opening folder…</Text></View>
        ) : (
          <LegendList
            data={visibleDirectories}
            recycleItems
            estimatedItemSize={66}
            drawDistance={360}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.listContent}
            keyExtractor={(entry) => entry.fileName}
            renderItem={({ item }) => (
              <PickerRow
                icon="folder"
                title={item.fileName}
                selected={false}
                disabled={adding}
                chevron
                onPress={() => navigate(joinDirectoryPath(directoryPath, item.fileName))}
              />
            )}
            ListEmptyComponent={<EmptyState icon="folder-open-outline" text={normalizedQuery === "" ? "This folder has no subfolders" : "No matching folders"} />}
          />
        )}
      </View>

      {mode === "directory" ? (
        <View style={styles.footer}>
          {directoryError !== null ? <Text style={styles.errorText}>{directoryError}</Text> : null}
          <Button variant="primary" isDisabled={adding || directoryLoading} onPress={() => void addCurrentDirectory()}>
            {adding ? "Adding project…" : "Use this folder"}
          </Button>
        </View>
      ) : (
        <View style={styles.footerStatus}>
          {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
          {busy ? <Text style={styles.stateText}>Switching project…</Text> : null}
          {projectActionError !== null ? <Text style={styles.errorText}>{projectActionError}</Text> : null}
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

function ProjectChoiceRow({ project, cwd, busy, pinned = false, pinning = false, onPin, onSelect }: {
  project: RemoteProject;
  cwd: string;
  busy: boolean;
  pinned?: boolean;
  pinning?: boolean;
  onPin?: (() => void) | undefined;
  onSelect(cwd: string | null): Promise<void>;
}) {
  const selected = projectIncludesDirectory(project, cwd);
  return (
    <PickerRow
      icon={pinned ? "pin" : "folder-outline"}
      title={project.name}
      subtitle={project.path}
      selected={selected}
      disabled={busy}
      action={onPin === undefined ? undefined : {
        label: "Pin",
        accessibilityLabel: `Pin ${project.name}`,
        loading: pinning,
        onPress: onPin,
      }}
      onPress={() => { if (!busy && !selected) void onSelect(project.path); }}
    />
  );
}

function PickerRow({ icon, title, subtitle, selected, disabled, chevron = false, action, onPress }: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  selected: boolean;
  disabled: boolean;
  chevron?: boolean;
  action?: {
    label: string;
    accessibilityLabel: string;
    loading: boolean;
    onPress(): void;
  } | undefined;
  onPress(): void;
}) {
  return (
    <ListGroup variant={selected ? "tertiary" : "secondary"} style={[styles.rowSurface, disabled && styles.disabled]}>
      <View style={styles.rowLayout}>
        <ListGroup.Item
          style={styles.rowItem}
          accessibilityRole="button"
          accessibilityState={{ selected, disabled }}
          disabled={disabled}
          onPress={onPress}
        >
          <ListGroup.ItemPrefix style={[styles.rowIcon, selected && styles.rowIconSelected]}>
            <Ionicons name={icon} size={21} color={selected ? colors.text : colors.textMuted} />
          </ListGroup.ItemPrefix>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle numberOfLines={1}>{title}</ListGroup.ItemTitle>
            {subtitle !== undefined ? <ListGroup.ItemDescription numberOfLines={2}>{subtitle}</ListGroup.ItemDescription> : null}
          </ListGroup.ItemContent>
          {action === undefined ? (
            <ListGroup.ItemSuffix>
              <Ionicons name={selected ? "checkmark-circle" : chevron ? "chevron-forward" : "ellipse-outline"} size={20} color={selected ? colors.accent : colors.textDim} />
            </ListGroup.ItemSuffix>
          ) : null}
        </ListGroup.Item>
        {action !== undefined ? (
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
        ) : null}
      </View>
    </ListGroup>
  );
}

function EmptyState({ icon, text, compact = false }: { icon: keyof typeof Ionicons.glyphMap; text: string; compact?: boolean }) {
  return (
    <View style={[styles.emptyState, compact && styles.emptyStateCompact]}>
      <Ionicons name={icon} size={30} color={colors.textDim} />
      <Text style={styles.stateText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  titleBlock: { flex: 1, minWidth: 0 },
  title: { ...typeScale.titleLarge, color: colors.text },
  subtitle: { ...typeScale.labelMedium, color: colors.textMuted },
  pathPanel: {
    marginTop: spacing.xs,
    padding: spacing.xs,
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceRaised,
  },
  pathActions: { flexDirection: "row", alignItems: "center", minWidth: 0 },
  breadcrumbs: { alignItems: "center", paddingRight: spacing.sm },
  crumbGroup: { flexDirection: "row", alignItems: "center" },
  rawPath: { ...typeScale.labelMedium, color: colors.textMuted, paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  searchField: { marginTop: spacing.sm },
  listFrame: { flex: 1, minHeight: 0, marginTop: spacing.sm },
  projectScroll: { flex: 1, minHeight: 0 },
  listContent: { paddingBottom: spacing.sm },
  sectionLabel: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.xs },
  sectionTitle: { ...typeScale.labelLarge, color: colors.text },
  sectionCount: { ...typeScale.labelMedium, color: colors.textMuted },
  projectAccordion: { marginTop: spacing.sm, borderRadius: radii.medium, overflow: "hidden" },
  accordionTitle: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  accordionContent: { paddingHorizontal: spacing.xs, paddingBottom: spacing.xs },
  serverDefaultRow: { marginTop: spacing.sm },
  rowSurface: { marginBottom: spacing.xs, borderRadius: radii.medium, overflow: "hidden" },
  rowLayout: { flexDirection: "row", alignItems: "center" },
  rowItem: { flex: 1, minWidth: 0 },
  rowAction: { flexShrink: 0, marginRight: spacing.sm },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: radii.small,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceHover,
  },
  rowIconSelected: { backgroundColor: colors.accentMuted },
  centerState: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  emptyState: { minHeight: 150, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  emptyStateCompact: { minHeight: 92 },
  stateText: { ...typeScale.bodyMedium, color: colors.textMuted },
  footer: { flexShrink: 0, gap: spacing.sm, paddingTop: spacing.sm },
  footerStatus: { minHeight: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  errorText: { ...typeScale.bodyMedium, color: colors.red },
  disabled: { opacity: 0.5 },
});
